import { NextResponse } from "next/server"
import type Stripe from "stripe"

import { applyOverageToUpcomingInvoice } from "@/lib/billing/overage"
import {
  getInvoiceSubscriptionId,
  getSubscriptionPeriodBounds,
} from "@/lib/billing/stripe-helpers"
import {
  fetchSubscription,
  markCompanyBillingCanceled,
  syncModulesFromSubscription,
  syncSeatQuantity,
  upsertCompanyBillingFromSubscription,
} from "@/lib/billing/sync"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

/**
 * Resolve the company for a Stripe event. Prefers the company_id we stamp on
 * subscription/checkout metadata, but falls back to looking the company up by the
 * stored stripe_subscription_id, then stripe_customer_id — so an event for a
 * subscription created out-of-band (or whose metadata is somehow absent) still
 * reconciles instead of silently no-op'ing. Returns null only when truly unknown.
 */
async function resolveCompanyId(opts: {
  metadata?: Stripe.Metadata | null
  subscriptionId?: string | null
  customerId?: string | null
}): Promise<string | null> {
  const fromMeta = opts.metadata?.company_id?.trim()
  if (fromMeta) return fromMeta

  const admin = createAdminClient()
  if (opts.subscriptionId) {
    const { data } = await admin
      .from("company_billing")
      .select("company_id")
      .eq("stripe_subscription_id", opts.subscriptionId)
      .maybeSingle()
    if (data?.company_id) return data.company_id
  }
  if (opts.customerId) {
    const { data } = await admin
      .from("company_billing")
      .select("company_id")
      .eq("stripe_customer_id", opts.customerId)
      .maybeSingle()
    if (data?.company_id) return data.company_id
  }
  return null
}

function customerIdOf(customer: string | { id: string } | null | undefined): string | null {
  if (!customer) return null
  return typeof customer === "string" ? customer : customer.id
}

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
  if (!session.customer || !session.subscription) return
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id
  const customerId = customerIdOf(session.customer)

  const companyId = await resolveCompanyId({
    metadata: session.metadata,
    subscriptionId,
    customerId,
  })
  if (!companyId || !customerId) return

  const subscription = await fetchSubscription(subscriptionId)

  await upsertCompanyBillingFromSubscription({
    companyId,
    customerId,
    subscription,
  })
  await syncModulesFromSubscription(companyId, subscription)
  await syncSeatQuantity(companyId)
}

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const customerId = customerIdOf(subscription.customer)
  const companyId = await resolveCompanyId({
    metadata: subscription.metadata,
    subscriptionId: subscription.id,
    customerId,
  })
  if (!companyId || !customerId) {
    console.warn("[stripe/webhook] subscription change: unresolved company", {
      subscriptionId: subscription.id,
      customerId,
    })
    return
  }

  await upsertCompanyBillingFromSubscription({
    companyId,
    customerId,
    subscription,
  })
  await syncModulesFromSubscription(companyId, subscription)
  await syncSeatQuantity(companyId)
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const companyId = await resolveCompanyId({
    metadata: subscription.metadata,
    subscriptionId: subscription.id,
    customerId: customerIdOf(subscription.customer),
  })
  if (!companyId) {
    console.warn("[stripe/webhook] subscription deleted: unresolved company", {
      subscriptionId: subscription.id,
    })
    return
  }

  // Clear all dangling Stripe pointers + drop à-la-carte modules so access is
  // revoked and no later write op hits the dead subscription id.
  await markCompanyBillingCanceled(companyId)
}

async function handleCustomerDeleted(customer: Stripe.Customer) {
  const companyId = await resolveCompanyId({ customerId: customer.id })
  if (!companyId) return
  const admin = createAdminClient()
  await markCompanyBillingCanceled(companyId)
  await admin
    .from("company_billing")
    .update({ stripe_customer_id: null, updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
}

async function handleInvoiceUpcoming(invoice: Stripe.Invoice) {
  const subscriptionId = getInvoiceSubscriptionId(invoice)

  if (!subscriptionId || !invoice.customer) return

  const subscription = await fetchSubscription(subscriptionId)
  const customerId = customerIdOf(invoice.customer)
  const companyId = await resolveCompanyId({
    metadata: subscription.metadata,
    subscriptionId,
    customerId,
  })
  if (!companyId || !customerId) return

  // Use the SUBSCRIPTION's current period (the same bounds persisted to
  // company_billing.current_period_* and used by the usage-summary RPC) as the
  // canonical overage window, so the billed window matches what the user sees —
  // rather than invoice.period_start/end which can diverge at boundary changes.
  const periodBounds = getSubscriptionPeriodBounds(subscription)
  if (!periodBounds.start || !periodBounds.end) return

  const periodStart = new Date(periodBounds.start * 1000).toISOString()
  const periodEnd = new Date(periodBounds.end * 1000).toISOString()

  await applyOverageToUpcomingInvoice({
    companyId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    stripeInvoiceId: invoice.id,
    periodStart,
    periodEnd,
  })
}

async function setBillingStatusFromInvoice(
  invoice: Stripe.Invoice,
  status: "past_due" | "unpaid"
) {
  const subscriptionId = getInvoiceSubscriptionId(invoice)
  if (!subscriptionId) return

  const subscription = await fetchSubscription(subscriptionId)
  const companyId = await resolveCompanyId({
    metadata: subscription.metadata,
    subscriptionId,
    customerId: customerIdOf(invoice.customer),
  })
  if (!companyId) return

  // Trust Stripe's own status when it's more specific (e.g. already canceled),
  // otherwise apply the dunning status.
  const admin = createAdminClient()
  await admin
    .from("company_billing")
    .update({
      status: (subscription.status as string) === "canceled" ? "canceled" : status,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
    .eq("stripe_subscription_id", subscriptionId)
}

export async function POST(request: Request) {
  const stripe = getStripe()
  // Support a comma-separated list so the endpoint secret can be rotated with
  // zero dropped events (set STRIPE_WEBHOOK_SECRET="new,old" during cutover).
  const webhookSecrets = (process.env.STRIPE_WEBHOOK_SECRET ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)

  if (webhookSecrets.length === 0) {
    return NextResponse.json({ error: "Webhook secret mangler" }, { status: 500 })
  }

  const signature = request.headers.get("stripe-signature")
  if (!signature) {
    return NextResponse.json({ error: "Manglende signatur" }, { status: 400 })
  }

  const body = await request.text()

  let event: Stripe.Event | null = null
  let lastError: unknown = null
  for (const secret of webhookSecrets) {
    try {
      event = stripe.webhooks.constructEvent(body, signature, secret)
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!event) {
    console.error("[stripe/webhook] signature error", lastError)
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
      case "customer.deleted":
        await handleCustomerDeleted(event.data.object as Stripe.Customer)
        break
      case "invoice.upcoming":
        await handleInvoiceUpcoming(event.data.object as Stripe.Invoice)
        break
      case "invoice.payment_failed":
        await setBillingStatusFromInvoice(event.data.object as Stripe.Invoice, "past_due")
        break
      case "invoice.marked_uncollectible":
        await setBillingStatusFromInvoice(event.data.object as Stripe.Invoice, "unpaid")
        break
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice
        const subscriptionId = getInvoiceSubscriptionId(invoice)
        if (subscriptionId) {
          const subscription = await fetchSubscription(subscriptionId)
          const customerId = customerIdOf(invoice.customer) ?? customerIdOf(subscription.customer)
          const companyId = await resolveCompanyId({
            metadata: subscription.metadata,
            subscriptionId,
            customerId,
          })
          if (companyId && customerId) {
            await upsertCompanyBillingFromSubscription({
              companyId,
              customerId,
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
    // Roll back the idempotency record so Stripe's retry re-processes this event
    // instead of hitting the duplicate guard and silently dropping the work.
    await createAdminClient().from("stripe_webhook_events").delete().eq("event_id", event.id)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook-feil" },
      { status: 500 }
    )
  }
}
