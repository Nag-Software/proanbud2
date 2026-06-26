import type Stripe from "stripe"

/**
 * True when a Stripe error means the referenced object no longer exists
 * (e.g. a subscription/customer that was deleted in the Stripe dashboard or via
 * the customer portal). This is the signal that our DB has drifted away from
 * Stripe and must self-heal instead of bubbling a raw 500 to the user.
 */
export function isStripeResourceMissing(err: unknown): boolean {
  if (!err || typeof err !== "object") return false
  const e = err as { type?: string; code?: string; statusCode?: number; raw?: { code?: string } }
  return (
    e.code === "resource_missing" ||
    e.raw?.code === "resource_missing" ||
    (e.type === "StripeInvalidRequestError" && e.statusCode === 404)
  )
}

/**
 * Thrown by a billing write op when the company's stored subscription no longer
 * exists in Stripe. Routes map this to HTTP 409 + code "subscription_missing"
 * so the client can route the user back to checkout instead of showing an error.
 */
export class SubscriptionMissingError extends Error {
  readonly code = "subscription_missing" as const
  constructor(
    message = "Abonnementet finnes ikke lenger i Stripe. Start et nytt abonnement for å fortsette."
  ) {
    super(message)
    this.name = "SubscriptionMissingError"
  }
}

export function getSubscriptionPeriodBounds(subscription: Stripe.Subscription): {
  start: number | null
  end: number | null
} {
  // Prefer the base-plan item's period; fall back to the first item. (Add-on
  // items like seats/modules can share the cycle but ordering is not guaranteed.)
  const items = subscription.items?.data ?? []
  const baseItem = items.find((item) => {
    const kind = item.price?.metadata?.kind
    return !kind || kind === "base"
  })
  const item = baseItem ?? items[0]
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
