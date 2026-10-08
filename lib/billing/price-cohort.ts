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

/**
 * Hvilken prisliste bedriften står på.
 *
 * - Uten levende abonnement (utløpt prøve, avsluttet, aldri startet): dagens
 *   pris, uansett når bedriften ble opprettet.
 * - Med levende abonnement: kohorten grunnplanen i Stripe faktisk har. Det er
 *   den eneste kilden som holder seg riktig når en bedrift opprettet før
 *   prisøkningen tegner nytt abonnement til dagens pris etter at prøven utløp.
 * - Kan prisen ikke gjenkjennes (ukjent pris-ID, Stripe nede): faller tilbake
 *   på opprettelsesdatoen, slik regelen opprinnelig var.
 */
export async function getCompanyPriceCohort(companyId: string): Promise<PriceCohort> {
  const admin = createAdminClient()
  const [{ data: company }, { data: billing }] = await Promise.all([
    admin.from("companies").select("created_at").eq("id", companyId).maybeSingle(),
    admin
      .from("company_billing")
      .select("status, stripe_subscription_id")
      .eq("company_id", companyId)
      .maybeSingle(),
  ])

  if (!hasBillableAccess(billing?.status as string | null)) return "current"

  const createdAt = (company?.created_at as string | null) ?? null
  const subscriptionId = billing?.stripe_subscription_id as string | null
  if (!subscriptionId) return priceCohortFor(createdAt)

  try {
    const subscription = await getStripe().subscriptions.retrieve(subscriptionId, {
      expand: ["items.data.price"],
    })
    return priceCohortFromSubscriptionItems(subscription.items.data) ?? priceCohortFor(createdAt)
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
