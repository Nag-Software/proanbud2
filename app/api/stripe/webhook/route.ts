import { NextResponse } from "next/server"
import type Stripe from "stripe"

import { applyOverageToUpcomingInvoice } from "@/lib/billing/overage"
import {
  getInvoiceSubscriptionId,
  getSubscriptionPeriodBounds,
} from "@/lib/billing/stripe-helpers"
import {
  fetchSubscription,
  getCompanyIdFromStripeMetadata,
  syncModulesFromSubscription,
  syncSeatQuantity,
  upsertCompanyBillingFromSubscription,
} from "@/lib/billing/sync"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

async function recordWebhookEvent(event: Stripe.Event) {
  const admin = createAdminClient()
  const { error } = await admin.from("stripe_webhook_events").insert({
    event_id: event.id,
    event_type: event.type,
  })

  if (error?.code === "23505") {
    return false
  }

  if (error) {
    throw new Error(error.message)
  }

  return true
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const companyId = await getCompanyIdFromStripeMetadata(session.metadata)
  if (!companyId || !session.customer || !session.subscription) return

  const subscription = await fetchSubscription(
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription.id
  )

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer.id

  await upsertCompanyBillingFromSubscription({
    companyId,
    customerId,
    subscription,
  })
  await syncModulesFromSubscription(companyId, subscription)
  await syncSeatQuantity(companyId)
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const companyId = await getCompanyIdFromStripeMetadata(subscription.metadata)
  if (!companyId) return

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id

  await upsertCompanyBillingFromSubscription({
    companyId,
    customerId,
    subscription,
  })
  await syncModulesFromSubscription(companyId, subscription)
  await syncSeatQuantity(companyId)
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const companyId = await getCompanyIdFromStripeMetadata(subscription.metadata)
  if (!companyId) return

  const admin = createAdminClient()
  await admin
    .from("company_billing")
    .update({
      status: "canceled",
      stripe_subscription_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
}

async function handleInvoiceUpcoming(invoice: Stripe.Invoice) {
  const subscriptionId = getInvoiceSubscriptionId(invoice)

  if (!subscriptionId || !invoice.customer) return

  const subscription = await fetchSubscription(subscriptionId)
  const companyId = await getCompanyIdFromStripeMetadata(subscription.metadata)
  if (!companyId) return

  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer.id

  const periodBounds = getSubscriptionPeriodBounds(subscription)
  const periodStartUnix = invoice.period_start ?? periodBounds.start
  const periodEndUnix = invoice.period_end ?? periodBounds.end
  if (!periodStartUnix || !periodEndUnix) return

  const periodStart = new Date(periodStartUnix * 1000).toISOString()
  const periodEnd = new Date(periodEndUnix * 1000).toISOString()

  await applyOverageToUpcomingInvoice({
    companyId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripeInvoiceId: invoice.id,
    periodStart,
    periodEnd,
  })
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = getInvoiceSubscriptionId(invoice)

  if (!subscriptionId) return

  const subscription = await fetchSubscription(subscriptionId)
  const companyId = await getCompanyIdFromStripeMetadata(subscription.metadata)
  if (!companyId) return

  const admin = createAdminClient()
  await admin
    .from("company_billing")
    .update({
      status: "past_due",
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
}

export async function POST(request: Request) {
  const stripe = getStripe()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim()

  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook secret mangler" }, { status: 500 })
  }

  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "Manglende signatur" }, { status: 400 })
  }

  const body = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (error) {
    console.error("[stripe/webhook] signature error", error)
    return NextResponse.json({ error: "Ugyldig signatur" }, { status: 400 })
  }

  try {
    const isNew = await recordWebhookEvent(event)
    if (!isNew) {
      return NextResponse.json({ received: true, duplicate: true })
    }

    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session)
        break
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionChange(event.data.object as Stripe.Subscription)
        break
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription)
        break
      case "invoice.upcoming":
        await handleInvoiceUpcoming(event.data.object as Stripe.Invoice)
        break
      case "invoice.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.Invoice)
        break
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = getInvoiceSubscriptionId(invoice)
        if (subscriptionId) {
          const subscription = await fetchSubscription(subscriptionId)
          const companyId = await getCompanyIdFromStripeMetadata(subscription.metadata)
          if (companyId) {
            await upsertCompanyBillingFromSubscription({
              companyId,
              customerId:
                typeof subscription.customer === "string"
                  ? subscription.customer
                  : subscription.customer.id,
              subscription,
            })
          }
        }
        break
      }
      default:
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error("[stripe/webhook]", event.type, error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook-feil" },
      { status: 500 }
    )
  }
}
