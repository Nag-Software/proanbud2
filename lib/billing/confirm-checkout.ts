import type Stripe from "stripe"

import {
  fetchSubscription,
  markCompanyBillingCanceled,
  syncModulesFromSubscription,
  syncSeatQuantity,
  upsertCompanyBillingFromSubscription,
} from "@/lib/billing/sync"
import { isActiveSubscriptionStatus } from "@/lib/billing/plans"
import { isStripeResourceMissing } from "@/lib/billing/stripe-helpers"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

const LIVE_SUBSCRIPTION_STATUSES = ["trialing", "active", "past_due"]

export async function syncBillingFromCheckoutSession(
  session: Stripe.Checkout.Session,
  expectedCompanyId: string
) {
  const companyId = session.metadata?.company_id?.trim()
  if (!companyId || companyId !== expectedCompanyId) {
    throw new Error("Checkout-session tilhører ikke denne bedriften.")
  }

  if (session.status !== "complete") {
    throw new Error("Checkout er ikke fullført ennå.")
  }

  if (!session.customer || !session.subscription) {
    throw new Error("Manglende kunde eller abonnement i checkout.")
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer.id

  const subscription = await fetchSubscription(subscriptionId)

  await upsertCompanyBillingFromSubscription({
    companyId,
    customerId,
    subscription,
  })
  await syncModulesFromSubscription(companyId, subscription)
  await syncSeatQuantity(companyId)

  return subscription.status
}

export async function confirmCheckoutSession(
  sessionId: string,
  expectedCompanyId: string
) {
  const stripe = getStripe()
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  return syncBillingFromCheckoutSession(session, expectedCompanyId)
}

/**
 * Make the local company_billing row agree with Stripe (Stripe is the source of
 * truth), in BOTH directions. Used as the webhook-miss fallback (onboarding,
 * write-op self-heal, daily cron).
 *
 * Unlike the old version, an "active" DB row is NOT trusted blindly: the stored
 * subscription is verified against Stripe. If it is gone or no longer live, the
 * row is downgraded to canceled and we search the customer for any other live
 * subscription before giving up. This is what heals the manual-delete drift
 * (status stuck at 'active' pointing at a dead subscription).
 *
 * Returns the resulting status string ("active"/"trialing"/"past_due"/"canceled")
 * or null when the company has no Stripe customer at all.
 */
export async function reconcileCompanyBillingFromStripe(
  companyId: string
): Promise<string | null> {
  const admin = createAdminClient()
  const stripe = getStripe()

  const { data: billing } = await admin
    .from("company_billing")
    .select("stripe_customer_id, stripe_subscription_id, status")
    .eq("company_id", companyId)
    .maybeSingle()

  let customerId = billing?.stripe_customer_id ?? null

  // Verify the stored subscription still exists and is live in Stripe.
  if (billing?.stripe_subscription_id) {
    try {
      const sub = await fetchSubscription(billing.stripe_subscription_id)
      if (LIVE_SUBSCRIPTION_STATUSES.includes(sub.status)) {
        // Confirmed live: refresh from the live object (cheap, idempotent) so a
        // stale status/plan in the DB is corrected, then reconcile seats.
        await upsertCompanyBillingFromSubscription({
          companyId,
          customerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          subscription: sub,
        })
        await syncModulesFromSubscription(companyId, sub)
        await syncSeatQuantity(companyId)
        return sub.status
      }
      // Sub exists but is canceled/incomplete_expired/etc. → fall through to heal.
    } catch (error) {
      if (!isStripeResourceMissing(error)) throw error
      // resource_missing → the subscription was hard-deleted in Stripe.
    }
    // Stored sub is dead/non-live: clear the stale pointer so the search below
    // (and any future write op) doesn't keep hitting a ghost subscription.
    await markCompanyBillingCanceled(companyId)
  }

  if (!customerId) {
    const search = await stripe.customers.search({
      query: `metadata['company_id']:'${companyId}'`,
      limit: 1,
    })
    customerId = search.data[0]?.id ?? null
  }

  if (!customerId) return null

  const subscriptions = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 10,
  })

  const live = subscriptions.data.find((sub) =>
    LIVE_SUBSCRIPTION_STATUSES.includes(sub.status)
  )

  if (!live) {
    // Stripe is truth: customer has no live subscription → the DB must not claim
    // active. (markCompanyBillingCanceled above already handled the had-a-sub
    // case; this also downgrades a row that only had a customer id.)
    await markCompanyBillingCanceled(companyId)
    return "canceled"
  }

  await upsertCompanyBillingFromSubscription({
    companyId,
    customerId,
    subscription: live,
  })
  await syncModulesFromSubscription(companyId, live)
  await syncSeatQuantity(companyId)

  return live.status
}

/**
 * Recover from a write op that hit a dead subscription (resource_missing):
 * clear the drift, then try to pick up any still-live subscription on the same
 * customer. Returns the recovered live status, or null when the company now has
 * no active subscription (caller should surface a re-subscribe path).
 */
export async function recoverFromDeadSubscription(
  companyId: string
): Promise<string | null> {
  await markCompanyBillingCanceled(companyId)
  // reconcile now sees a null subscription id, so it goes straight to the
  // customer-subscription search and re-links a live sub if one exists.
  const status = await reconcileCompanyBillingFromStripe(companyId)
  return isActiveSubscriptionStatus(status) ? status : null
}
