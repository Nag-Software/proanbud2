import {
  hasBillableAccess,
  priceCohortFor,
  priceCohortFromSubscriptionItems,
  type PriceCohort,
} from "@/lib/billing/plans"
import { isStripeResourceMissing } from "@/lib/billing/stripe-helpers"
import { logServerError } from "@/lib/errors/log"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

type BillingCohortRow = {
  status: string | null
  stripe_subscription_id: string | null
  price_cohort: PriceCohort | null
}

function isCohort(value: unknown): value is PriceCohort {
  return value === "current" || value === "legacy"
}

/**
 * Hvilken prisliste bedriften står på.
 *
 * - Uten levende abonnement (utløpt prøve, avsluttet, aldri startet): dagens
 *   pris, uansett når bedriften ble opprettet.
 * - Med levende abonnement: kohorten grunnplanen i Stripe faktisk har. Den er
 *   lagret i company_billing.price_cohort av billing-synken (db/113); mangler
 *   den, slås den opp i Stripe én gang og skrives tilbake.
 * - Kan prisen ikke gjenkjennes (ukjent pris-ID, Stripe nede): faller tilbake
 *   på opprettelsesdatoen, slik regelen opprinnelig var.
 */
export async function getCompanyPriceCohort(companyId: string): Promise<PriceCohort> {
  const admin = createAdminClient()
  const [{ data: company }, billing] = await Promise.all([
    admin.from("companies").select("created_at").eq("id", companyId).maybeSingle(),
    readBillingCohortRow(companyId),
  ])

  if (!hasBillableAccess(billing?.status)) return "current"
  if (isCohort(billing?.price_cohort)) return billing.price_cohort

  const createdAt = (company?.created_at as string | null) ?? null
  const subscriptionId = billing?.stripe_subscription_id ?? null
  if (!subscriptionId) return priceCohortFor(createdAt)

  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    })
    const resolved = priceCohortFromSubscriptionItems(subscription.items.data)
    if (resolved) {
      // Best-effort: neste oppslag trenger ikke Stripe. Feiler skrivingen
      // (f.eks. db/113 ikke kjørt), er svaret fortsatt riktig.
      await admin
        .from("company_billing")
        .update({ price_cohort: resolved })
        .eq("company_id", companyId)
      return resolved
    }
    return priceCohortFor(createdAt)
  } catch (error) {
    // Abonnementet er borte i Stripe → ikke levende → dagens pris. (Reconcile
    // rydder DB-raden ved neste kall; her skal vi bare ikke love gammel pris.)
    if (isStripeResourceMissing(error)) return "current"
    void logServerError({
      message: "Priskohort: kunne ikke lese abonnementet fra Stripe — bruker opprettelsesdato",
      error,
      level: "warning",
      source: "server",
      route: "getCompanyPriceCohort",
      context: { companyId, subscriptionId },
    })
    return priceCohortFor(createdAt)
  }
}

/**
 * Leser status, abonnements-ID og lagret kohort. Er db/113 ikke kjørt ennå,
 * svarer PostgREST med feil på den ukjente kolonnen — da leses raden uten den.
 */
async function readBillingCohortRow(companyId: string): Promise<BillingCohortRow | null> {
  const admin = createAdminClient()
  const withCohort = await admin
    .from("company_billing")
    .select("status, stripe_subscription_id, price_cohort")
    .eq("company_id", companyId)
    .maybeSingle()
  if (!withCohort.error) return (withCohort.data as BillingCohortRow | null) ?? null

  const { data } = await admin
    .from("company_billing")
    .select("status, stripe_subscription_id")
    .eq("company_id", companyId)
    .maybeSingle()
  return data ? { ...(data as Omit<BillingCohortRow, "price_cohort">), price_cohort: null } : null
}
