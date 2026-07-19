// Velkomstrabatt: 80 % av første måned etter prøveperioden.
//
// Prøveperioden er KORTFRI (createTrialSubscription lager abonnementet uten
// betalingsmetode, end_behavior = cancel). Den konverterer derfor ikke av seg
// selv — brukeren må legge inn kort for å fortsette. Velkomstrabatten er
// gulroten i den overgangen: hver bedrift får sin EGEN kampanjekode.
//
// Egenskaper (alle håndhevet i Stripe, ikke bare i UI):
//   • percent_off 80, duration "once"  → gjelder kun første faktura
//   • max_redemptions 1                → kan bare brukes én gang
//   • customer: <bedriftens kunde>     → kan ikke brukes av andre
//
// Koden lagres på company_billing (db/74) slik at neste påminnelse gjenbruker
// den samme koden i stedet for å lage en ny.

import type Stripe from "stripe"

import { isStripeResourceMissing } from "@/lib/billing/stripe-helpers"
import { getStripe, isStripeConfigured } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const WELCOME_DISCOUNT_PERCENT = 80

export type WelcomeDiscount = {
  code: string
  promotionCodeId: string
  appliedAt: string | null
}

/** Menneskevennlig kode: ingen 0/O/1/I, så den kan leses opp på telefon. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  let suffix = ""
  for (const byte of bytes) suffix += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  return `VELKOMST-${suffix}`
}

/** Rabattert førstemåned i kroner, avrundet til nærmeste krone. */
export function discountedFirstMonthNok(fullMonthlyNok: number): number {
  return Math.round((fullMonthlyNok * (100 - WELCOME_DISCOUNT_PERCENT)) / 100)
}

/** Lest, aldri opprettet — for visning i appen. */
export async function getWelcomeDiscount(companyId: string): Promise<WelcomeDiscount | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("company_billing")
    .select("welcome_promo_code, welcome_promo_id, welcome_discount_applied_at")
    .eq("company_id", companyId)
    .maybeSingle()

  if (!data?.welcome_promo_code || !data.welcome_promo_id) return null
  return {
    code: data.welcome_promo_code as string,
    promotionCodeId: data.welcome_promo_id as string,
    appliedAt: (data.welcome_discount_applied_at as string | null) ?? null,
  }
}

/**
 * Som getWelcomeDiscount, men bekreftet mot Stripe: returnerer bare en kode som
 * FAKTISK kan løses inn nå. Nødvendig før den sendes inn i Checkout — en
 * oppbrukt eller slettet kode ville ellers feilet hele betalingsøkten.
 * Feiler stille (null) — en manglende rabatt skal aldri stoppe en betaling.
 */
export async function getRedeemableWelcomeDiscount(
  companyId: string
): Promise<WelcomeDiscount | null> {
  if (!isStripeConfigured()) return null
  try {
    const stored = await getWelcomeDiscount(companyId)
    if (!stored) return null
    const promotionCode = await getStripe().promotionCodes.retrieve(stored.promotionCodeId)
    return promotionCode.active ? stored : null
  } catch {
    return null
  }
}

/**
 * Hent eller lag bedriftens personlige velkomstkode.
 *
 * Idempotent på to nivåer: lagret kode gjenbrukes hvis den fortsatt er gyldig i
 * Stripe, og selve opprettelsen bruker deterministiske idempotency-nøkler så en
 * retry etter et tapt svar ikke gir bedriften to koder.
 *
 * Returnerer null når Stripe ikke er konfigurert, bedriften mangler
 * Stripe-kunde, eller koden allerede er brukt opp.
 */
export async function ensureWelcomeDiscount(companyId: string): Promise<WelcomeDiscount | null> {
  if (!isStripeConfigured()) return null

  const stripe = getStripe()
  const admin = createAdminClient()

  const { data: billing } = await admin
    .from("company_billing")
    .select("stripe_customer_id, welcome_promo_code, welcome_promo_id, welcome_discount_applied_at")
    .eq("company_id", companyId)
    .maybeSingle()

  const customerId = billing?.stripe_customer_id as string | undefined
  if (!customerId) return null

  if (billing?.welcome_promo_id) {
    try {
      const existing = await stripe.promotionCodes.retrieve(billing.welcome_promo_id as string)
      // Oppbrukt kode skal ikke gjenoppstå — den var en engangsbonus.
      if (existing.active) {
        return {
          code: existing.code,
          promotionCodeId: existing.id,
          appliedAt: (billing.welcome_discount_applied_at as string | null) ?? null,
        }
      }
      return null
    } catch (error) {
      if (!isStripeResourceMissing(error)) throw error
      // Slettet i Stripe — fall gjennom og lag en ny.
    }
  }

  const coupon = await stripe.coupons.create(
    {
      percent_off: WELCOME_DISCOUNT_PERCENT,
      duration: "once",
      name: `Velkomstrabatt ${WELCOME_DISCOUNT_PERCENT} % — første måned`,
      max_redemptions: 1,
      metadata: { company_id: companyId, kind: "welcome_discount" },
    },
    { idempotencyKey: `welcome-coupon-${companyId}` }
  )

  const promotionCode = await createPromotionCodeWithUniqueCode(stripe, {
    companyId,
    customerId,
    couponId: coupon.id,
  })

  await admin
    .from("company_billing")
    .update({
      welcome_promo_code: promotionCode.code,
      welcome_promo_id: promotionCode.id,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)

  return { code: promotionCode.code, promotionCodeId: promotionCode.id, appliedAt: null }
}

/** Koden er tilfeldig, så en kollisjon mot en eksisterende kode er mulig (om enn
 *  usannsynlig) — Stripe avviser den, og vi prøver en ny. */
async function createPromotionCodeWithUniqueCode(
  stripe: Stripe,
  input: { companyId: string; customerId: string; couponId: string }
): Promise<Stripe.PromotionCode> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await stripe.promotionCodes.create(
        {
          coupon: input.couponId,
          code: generateCode(),
          customer: input.customerId,
          max_redemptions: 1,
          metadata: { company_id: input.companyId, kind: "welcome_discount" },
        },
        // Samme nøkkel per forsøk: en retry etter tapt svar returnerer samme kode,
        // mens en ekte kollisjon får neste forsøk sin egen nøkkel.
        { idempotencyKey: `welcome-promo-${input.companyId}-${attempt}` }
      )
    } catch (error) {
      lastError = error
      const code = (error as Stripe.errors.StripeError)?.code
      if (code !== "resource_already_exists") throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Kunne ikke lage kampanjekode")
}

/**
 * Fest velkomstrabatten på bedriftens levende abonnement.
 *
 * Kortfri prøve = abonnementet finnes allerede, og første faktura kommer når
 * prøven går over til betalt. Med duration "once" treffer rabatten nettopp den
 * fakturaen — brukeren trenger ikke taste inn koden noe sted.
 *
 * Feiler stille (returnerer false): dette skal aldri velte en e-postutsending.
 */
export async function applyWelcomeDiscountToSubscription(
  companyId: string,
  discount: WelcomeDiscount
): Promise<boolean> {
  if (discount.appliedAt) return true

  const stripe = getStripe()
  const admin = createAdminClient()

  const { data: billing } = await admin
    .from("company_billing")
    .select("stripe_subscription_id, status")
    .eq("company_id", companyId)
    .maybeSingle()

  const subscriptionId = billing?.stripe_subscription_id as string | undefined
  if (!subscriptionId) return false
  if (!["trialing", "active", "past_due"].includes((billing?.status as string) ?? "")) return false

  try {
    await stripe.subscriptions.update(subscriptionId, {
      discounts: [{ promotion_code: discount.promotionCodeId }],
    })
  } catch (error) {
    if (isStripeResourceMissing(error)) return false
    throw error
  }

  await admin
    .from("company_billing")
    .update({
      welcome_discount_applied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)

  return true
}
