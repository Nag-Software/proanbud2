import type Stripe from "stripe"

export function getSubscriptionPeriodBounds(subscription: Stripe.Subscription): {
  start: number | null
  end: number | null
} {
  const item = subscription.items?.data?.[0]
  return {
    start: item?.current_period_start ?? null,
    end: item?.current_period_end ?? null,
  }
}

export function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription
  if (!subscription) return null
  return typeof subscription === "string" ? subscription : subscription.id
}
