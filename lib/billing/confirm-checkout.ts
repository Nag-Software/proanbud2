import type Stripe from "stripe"

import {
  fetchSubscription,
  syncModulesFromSubscription,
  syncSeatQuantity,
  upsertCompanyBillingFromSubscription,
} from "@/lib/billing/sync"
import { isActiveSubscriptionStatus } from "@/lib/billing/plans"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

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

/** Fallback when webhook was delayed or missed (common in local dev). */
export async function reconcileCompanyBillingFromStripe(companyId: string) {
  const admin = createAdminClient()
  const stripe = getStripe()

  const { data: billing } = await admin
    .from("company_billing")
    .select("stripe_customer_id, stripe_subscription_id, status")
    .eq("company_id", companyId)
    .maybeSingle()

  let customerId = billing?.stripe_customer_id

  if (isActiveSubscriptionStatus(billing?.status) && billing?.stripe_subscription_id) {
    await syncSeatQuantity(companyId)
    return billing.status
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

  const active = subscriptions.data.find((sub) =>
    ["trialing", "active", "past_due"].includes(sub.status)
  )

  if (!active) return null

  await upsertCompanyBillingFromSubscription({
    companyId,
    customerId,
    subscription: active,
  })
  await syncModulesFromSubscription(companyId, active)
  await syncSeatQuantity(companyId)

  return active.status
}
