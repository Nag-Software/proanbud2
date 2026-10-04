import "server-only"

import type Stripe from "stripe"

import {
  RETENTION_OFFER_PERCENT,
  RETENTION_OFFER_REASON,
  type CancellationAnswer,
} from "@/lib/billing/cancellation-reasons"
import { recoverFromDeadSubscription } from "@/lib/billing/confirm-checkout"
import { isStripeResourceMissing, SubscriptionMissingError } from "@/lib/billing/stripe-helpers"
import { upsertCompanyBillingFromSubscription } from "@/lib/billing/sync"
import { logServerError } from "@/lib/errors/log"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

/** Delt kupong for alle som tar imot «bli»-tilbudet. Opprettes ved første bruk. */
const RETENTION_COUPON_ID = "behold-50-neste-mnd"

/** Statuser der det finnes et abonnement å avslutte. */
const CANCELLABLE_STATUSES = ["trialing", "active", "past_due"]

export class CancellationNotAllowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CancellationNotAllowedError"
  }
}

type BillingSnapshot = {
  stripe_subscription_id: string | null
  stripe_customer_id: string | null
  status: string | null
  plan_key: string | null
  billing_interval: string | null
  cancel_at_period_end: boolean | null
  created_at: string | null
}

async function loadBilling(companyId: string): Promise<BillingSnapshot | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from("company_billing")
    .select(
      "stripe_subscription_id, stripe_customer_id, status, plan_key, billing_interval, cancel_at_period_end, created_at"
    )
    .eq("company_id", companyId)
    .maybeSingle()
  return (data as BillingSnapshot | null) ?? null
}

/**
 * 50 %-tilbudet gjelder betalende kunder på månedlig trekk, én gang per firma.
 * Prøvekunder har ikke kort (kortfri prøve) og kan ikke trekkes automatisk;
 * på årlig trekk ville «neste måned» blitt halv pris på et helt år.
 */
export async function isRetentionOfferAvailable(
  companyId: string,
  billing?: Pick<BillingSnapshot, "status" | "billing_interval" | "cancel_at_period_end"> | null
): Promise<boolean> {
  const snapshot = billing === undefined ? await loadBilling(companyId) : billing
  if (!snapshot) return false
  if (snapshot.status !== "active" || snapshot.billing_interval !== "month") return false
  if (snapshot.cancel_at_period_end) return false

  const admin = createAdminClient()
  const { count, error } = await admin
    .from("subscription_cancellations")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("outcome", "discount_accepted")
  // Tabellen mangler (db/110 ikke kjørt) eller spørringen feilet: ikke tilby
  // rabatt vi ikke kan bokføre at er brukt.
  if (error) return false
  return (count ?? 0) === 0
}

async function ensureRetentionCoupon(stripe: Stripe): Promise<string> {
  try {
    const existing = await stripe.coupons.retrieve(RETENTION_COUPON_ID)
    if (existing.valid) return existing.id
  } catch (error) {
    if (!isStripeResourceMissing(error)) throw error
  }
  try {
    const created = await stripe.coupons.create({
      id: RETENTION_COUPON_ID,
      percent_off: RETENTION_OFFER_PERCENT,
      duration: "once",
      name: `${RETENTION_OFFER_PERCENT} % av neste måned`,
    })
    return created.id
  } catch (error) {
    // To samtidige forespørsler: den andre får «already exists» — kupongen finnes.
    if ((error as { code?: string })?.code === "resource_already_exists") return RETENTION_COUPON_ID
    throw error
  }
}

async function recordCancellation(input: {
  companyId: string
  userId: string
  answer: CancellationAnswer
  outcome: "canceled" | "discount_accepted"
  billing: BillingSnapshot
  cancelAt: string | null
}) {
  const admin = createAdminClient()
  const { data: company } = await admin
    .from("companies")
    .select("name")
    .eq("id", input.companyId)
    .maybeSingle()

  const { error } = await admin.from("subscription_cancellations").insert({
    company_id: input.companyId,
    company_name: company?.name ?? null,
    user_id: input.userId,
    reason: input.answer.reason,
    detail: input.answer.detail,
    outcome: input.outcome,
    plan_key: input.billing.plan_key,
    billing_interval: input.billing.billing_interval,
    status_at_cancel: input.billing.status,
    subscribed_since: input.billing.created_at,
    cancel_at: input.cancelAt,
  })

  // Stripe er allerede oppdatert — kunden skal ikke få feil fordi loggingen
  // sviktet. Svaret legges i feilloggen så det ikke går tapt.
  if (error) {
    await logServerError({
      message: "Oppsigelsesgrunn ble ikke lagret",
      error,
      source: "api",
      route: "/api/stripe/cancel",
      companyId: input.companyId,
      userId: input.userId,
      context: { outcome: input.outcome, reason: input.answer.reason, detail: input.answer.detail },
    })
  }
}

async function requireCancellableBilling(companyId: string) {
  const billing = await loadBilling(companyId)
  if (
    !billing?.stripe_subscription_id ||
    !billing.stripe_customer_id ||
    !CANCELLABLE_STATUSES.includes(billing.status ?? "")
  ) {
    throw new CancellationNotAllowedError("Fant ikke et aktivt abonnement å avslutte.")
  }
  return billing as BillingSnapshot & { stripe_subscription_id: string; stripe_customer_id: string }
}

async function updateSubscription(
  companyId: string,
  subscriptionId: string,
  params: Stripe.SubscriptionUpdateParams
) {
  try {
    return await getStripe().subscriptions.update(subscriptionId, params)
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      await recoverFromDeadSubscription(companyId)
      throw new SubscriptionMissingError()
    }
    throw error
  }
}

/** Avslutter abonnementet ved periodeslutt og lagrer grunnen. */
export async function cancelSubscriptionWithReason(input: {
  companyId: string
  userId: string
  answer: CancellationAnswer
}): Promise<{ cancelAt: string | null }> {
  const billing = await requireCancellableBilling(input.companyId)
  if (billing.cancel_at_period_end) {
    throw new CancellationNotAllowedError("Abonnementet er allerede satt til å avsluttes.")
  }

  const updated = await updateSubscription(input.companyId, billing.stripe_subscription_id, {
    cancel_at_period_end: true,
  })
  await upsertCompanyBillingFromSubscription({
    companyId: input.companyId,
    customerId: billing.stripe_customer_id,
    subscription: updated,
  })

  const cancelAt = updated.cancel_at ? new Date(updated.cancel_at * 1000).toISOString() : null
  await recordCancellation({ ...input, outcome: "canceled", billing, cancelAt })
  return { cancelAt }
}

/**
 * Kunden valgte «For dyrt» og tok imot tilbudet: abonnementet fortsetter, og
 * neste faktura trekkes automatisk med 50 % rabatt (kupong, `duration: once`).
 */
export async function acceptRetentionDiscount(input: {
  companyId: string
  userId: string
  answer: CancellationAnswer
}): Promise<void> {
  if (input.answer.reason !== RETENTION_OFFER_REASON) {
    throw new CancellationNotAllowedError("Tilbudet gjelder ikke for denne grunnen.")
  }
  const billing = await requireCancellableBilling(input.companyId)
  if (!(await isRetentionOfferAvailable(input.companyId, billing))) {
    throw new CancellationNotAllowedError("Tilbudet er ikke tilgjengelig for dette abonnementet.")
  }

  const stripe = getStripe()
  const couponId = await ensureRetentionCoupon(stripe)

  // `discounts` erstatter hele listen — ta med rabatter som allerede ligger på
  // abonnementet, så de ikke forsvinner.
  let existing: Stripe.SubscriptionUpdateParams.Discount[] = []
  try {
    const current = await stripe.subscriptions.retrieve(billing.stripe_subscription_id)
    existing = (current.discounts ?? []).map((discount) => ({
      discount: typeof discount === "string" ? discount : discount.id,
    }))
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      await recoverFromDeadSubscription(input.companyId)
      throw new SubscriptionMissingError()
    }
    throw error
  }

  await updateSubscription(input.companyId, billing.stripe_subscription_id, {
    discounts: [...existing, { coupon: couponId }],
  })

  await recordCancellation({ ...input, outcome: "discount_accepted", billing, cancelAt: null })
}

/** Angrer en oppsigelse som ennå ikke har trådt i kraft. */
export async function resumeSubscription(companyId: string): Promise<void> {
  const billing = await requireCancellableBilling(companyId)

  const updated = await updateSubscription(companyId, billing.stripe_subscription_id, {
    cancel_at_period_end: false,
  })
  await upsertCompanyBillingFromSubscription({
    companyId,
    customerId: billing.stripe_customer_id,
    subscription: updated,
  })

  const admin = createAdminClient()
  const { error } = await admin
    .from("subscription_cancellations")
    .update({ resumed_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("outcome", "canceled")
    .is("resumed_at", null)
  if (error) {
    await logServerError({
      message: "Gjenopptatt abonnement ble ikke stemplet på oppsigelsen",
      error,
      level: "warning",
      source: "api",
      route: "/api/stripe/resume",
      companyId,
    })
  }
}
