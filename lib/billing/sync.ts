import type Stripe from "stripe"

import {
  getSubscriptionPeriodBounds,
  isStripeResourceMissing,
} from "@/lib/billing/stripe-helpers"
import {
  chargeableSeats,
  includedSeatsForPlan,
  intervalFromPriceMetadata,
  planKeyFromPriceMetadata,
  quotaForPlan,
  type BillingInterval,
  type PlanKey,
} from "@/lib/billing/plans"
import type { BillingStatus } from "@/lib/billing/types"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStripe } from "@/lib/stripe/server"

function toIso(unix: number | null | undefined): string | null {
  if (!unix) return null
  return new Date(unix * 1000).toISOString()
}

/**
 * Mark a company's billing row as canceled and clear all dangling Stripe
 * pointers (subscription + seat item). Idempotent. Called whenever we discover
 * the stored subscription no longer exists in Stripe (drift self-heal) and from
 * the subscription.deleted webhook. Keeps stripe_customer_id so a future
 * checkout reuses the same customer.
 */
export async function markCompanyBillingCanceled(companyId: string) {
  const admin = createAdminClient()
  await admin
    .from("company_billing")
    .update({
      status: "canceled",
      stripe_subscription_id: null,
      stripe_seat_subscription_item_id: null,
      plan_key: null,
      billing_interval: null,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
  // À-la-carte modules are subscription items — they die with the subscription.
  await admin.from("company_modules").delete().eq("company_id", companyId)
}

export function resolveBasePlanFromSubscription(
  subscription: Stripe.Subscription
): { planKey: PlanKey | null; interval: BillingInterval | null; baseItemId: string | null } {
  for (const item of subscription.items.data) {
    const price = item.price
    const kind = price.metadata?.kind
    if (kind && kind !== "base") continue

    const planKey = planKeyFromPriceMetadata(price.metadata)
    const interval = intervalFromPriceMetadata(price.metadata)
    if (planKey) {
      return { planKey, interval, baseItemId: item.id }
    }
  }

  return { planKey: null, interval: null, baseItemId: null }
}

function findSubscriptionItemId(
  subscription: Stripe.Subscription,
  kind: string
): string | null {
  for (const item of subscription.items.data) {
    if (item.price.metadata?.kind === kind) {
      return item.id
    }
  }
  return null
}

export async function upsertCompanyBillingFromSubscription(input: {
  companyId: string
  customerId: string
  subscription: Stripe.Subscription
}) {
  const admin = createAdminClient()
  const { planKey, interval } = resolveBasePlanFromSubscription(input.subscription)
  const seatItemId = findSubscriptionItemId(input.subscription, "seat")

  const period = getSubscriptionPeriodBounds(input.subscription)

  // If the base plan can't be resolved (missing/corrupt price metadata) but the
  // subscription DOES have items and is live, this is an anomaly — never destroy
  // a known-good plan_key/quota by writing nulls/zeros. Preserve the existing
  // row's plan figures and log loudly. quota_limit=0 would otherwise bill EVERY
  // AI tilbud as overage. (See overage.ts which now also refuses to bill on a
  // zero/unresolved quota.)
  let resolvedPlan: PlanKey | null = planKey
  let resolvedInterval = interval
  let quotaLimit = quotaForPlan(planKey)
  let includedSeats = includedSeatsForPlan(planKey)

  if (!planKey && input.subscription.items.data.length > 0) {
    const { data: current } = await admin
      .from("company_billing")
      .select("plan_key, billing_interval, quota_limit, included_seats")
      .eq("company_id", input.companyId)
      .maybeSingle()
    if (current?.plan_key) {
      console.error(
        `[billing-sync] base plan unresolved for sub ${input.subscription.id} (company ${input.companyId}) — preserving existing plan_key=${current.plan_key}/quota=${current.quota_limit}`
      )
      resolvedPlan = current.plan_key as PlanKey
      resolvedInterval = (current.billing_interval as BillingInterval) ?? interval
      quotaLimit = current.quota_limit ?? quotaForPlan(resolvedPlan)
      includedSeats = current.included_seats ?? includedSeatsForPlan(resolvedPlan)
    }
  }

  const payload = {
    company_id: input.companyId,
    stripe_customer_id: input.customerId,
    stripe_subscription_id: input.subscription.id,
    plan_key: resolvedPlan,
    billing_interval: resolvedInterval,
    status: input.subscription.status as BillingStatus,
    trial_ends_at: toIso(input.subscription.trial_end),
    current_period_start: toIso(period.start),
    current_period_end: toIso(period.end),
    // Reflect a portal/dashboard "cancel at period end" so the UI can warn and
    // we don't keep upselling/reminding a leaving customer. Written from the live
    // object every sync so reversing the cancellation resets it.
    cancel_at_period_end: input.subscription.cancel_at_period_end ?? false,
    cancel_at: toIso(input.subscription.cancel_at),
    quota_limit: quotaLimit,
    included_seats: includedSeats,
    stripe_seat_subscription_item_id: seatItemId,
    updated_at: new Date().toISOString(),
  }

  const { error } = await admin.from("company_billing").upsert(payload, {
    onConflict: "company_id",
  })

  if (error) {
    throw new Error(`Kunne ikke synke billing: ${error.message}`)
  }

  return payload
}

export async function syncModulesFromSubscription(
  companyId: string,
  subscription: Stripe.Subscription
) {
  const admin = createAdminClient()
  const { planKey } = resolveBasePlanFromSubscription(subscription)
  const moduleItems = subscription.items.data.filter(
    (item) => item.price.metadata?.kind === "module"
  )

  const enabledKeys = new Set<string>()

  for (const item of moduleItems) {
    const moduleKey = item.price.metadata?.module_key
    if (!moduleKey) continue

    // Integrasjoner is bundled into Proff. If a company upgraded to Proff while
    // still carrying the paid integrasjoner module item, remove that item so they
    // are not double-charged for a feature the plan already includes.
    // Not adding it to enabledKeys lets the cleanup loop below drop the stale
    // company_modules row too. (Re-runs are idempotent: the item is already gone.)
    if (moduleKey === "integrasjoner" && planKey === "proff") {
      try {
        const stripe = getStripe()
        await stripe.subscriptionItems.del(item.id)
      } catch (error) {
        console.error("Kunne ikke fjerne integrasjoner-modulledd på Proff", error)
      }
      continue
    }

    enabledKeys.add(moduleKey)

    await admin.from("company_modules").upsert(
      {
        company_id: companyId,
        module_key: moduleKey,
        enabled_at: new Date().toISOString(),
        stripe_subscription_item_id: item.id,
      },
      { onConflict: "company_id,module_key" }
    )
  }

  const { data: existing } = await admin
    .from("company_modules")
    .select("module_key, stripe_subscription_item_id")
    .eq("company_id", companyId)

  for (const row of existing ?? []) {
    if (!enabledKeys.has(row.module_key)) {
      await admin
        .from("company_modules")
        .delete()
        .eq("company_id", companyId)
        .eq("module_key", row.module_key)
    }
  }
}

export async function ensureCompanyBillingRow(companyId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("company_billing")
    .select("company_id")
    .eq("company_id", companyId)
    .maybeSingle()

  if (data) return

  await admin.from("company_billing").insert({
    company_id: companyId,
    status: "incomplete",
    quota_limit: 100,
    included_seats: includedSeatsForPlan(null),
  })
}

export async function fetchSubscription(
  subscriptionId: string
): Promise<Stripe.Subscription> {
  const stripe = getStripe()
  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["items.data.price"],
  })
}

/** All active users in the company (for display). */
export async function countCompanySeats(companyId: string): Promise<number> {
  const admin = createAdminClient()
  const { count, error } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("is_active", true)

  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

/** Billable seats: only manager/worker — administrator is never billed. */
export async function countBillableSeats(companyId: string): Promise<number> {
  const admin = createAdminClient()
  const { count, error } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("is_active", true)
    .in("role", ["manager", "worker"])

  if (error) {
    throw new Error(error.message)
  }

  return count ?? 0
}

/**
 * Reconcile the billed employee-seat quantity against the company's current
 * billable headcount. Idempotent and self-healing:
 *  - If the stored subscription no longer exists in Stripe, the billing row is
 *    canceled (drift self-heal) and we return without throwing — callers in
 *    fire-and-forget contexts (invite flow) must not crash on drift.
 *  - Collapses any duplicate seat items (created by a concurrent-invite race)
 *    back to a single item with the correct quantity.
 *  - Picks the seat price matching the subscription's billing interval so a
 *    yearly subscription doesn't get a monthly seat item (prices_in_different_intervals).
 *
 * Returns a typed result so callers can react to a dead subscription.
 */
export async function syncSeatQuantity(
  companyId: string
): Promise<{ ok: true } | { ok: false; reason: "no_subscription" | "subscription_missing" }> {
  const admin = createAdminClient()
  const stripe = getStripe()

  const { data: billing } = await admin
    .from("company_billing")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle()

  if (!billing?.stripe_subscription_id) return { ok: false, reason: "no_subscription" }

  const billableSeats = await countBillableSeats(companyId)
  const included =
    billing.included_seats ??
    includedSeatsForPlan(billing.plan_key as PlanKey | null)
  const seatsToCharge = chargeableSeats(billableSeats, included)

  let subscription: Stripe.Subscription
  try {
    subscription = await fetchSubscription(billing.stripe_subscription_id)
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      console.error(
        `[syncSeatQuantity] subscription ${billing.stripe_subscription_id} missing in Stripe — marking company ${companyId} canceled`
      )
      await markCompanyBillingCanceled(companyId)
      return { ok: false, reason: "subscription_missing" }
    }
    throw error
  }

  const { getSeatPriceId } = await import("@/lib/billing/plans")
  const seatInterval = (billing.billing_interval as BillingInterval | null) ?? "month"

  // Reconcile ALL seat items (not just the first) so a concurrent-invite race
  // that created duplicates self-corrects on the next run.
  const seatItems = subscription.items.data.filter(
    (item) => item.price.metadata?.kind === "seat"
  )
  let seatItemId: string | null = null

  if (seatsToCharge === 0) {
    for (const item of seatItems) {
      await stripe.subscriptionItems.del(item.id)
    }
    seatItemId = null
  } else if (seatItems.length === 0) {
    // No idempotency key: the duplicate-create race is already handled by the
    // seatItems.length > 0 branch (keeps one, deletes extras) on the next run. A
    // deterministic key would REPLAY a cached create after the seats-to-0 branch
    // deleted the item, re-linking a dead item id (seats under-billed).
    const created = await stripe.subscriptionItems.create({
      subscription: billing.stripe_subscription_id,
      price: getSeatPriceId(seatInterval),
      quantity: seatsToCharge,
    })
    seatItemId = created.id
  } else {
    const [keep, ...extras] = seatItems
    await stripe.subscriptionItems.update(keep.id, { quantity: seatsToCharge })
    for (const dup of extras) {
      await stripe.subscriptionItems.del(dup.id)
    }
    seatItemId = keep.id
  }

  await admin
    .from("company_billing")
    .update({
      stripe_seat_subscription_item_id: seatItemId,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)

  return { ok: true }
}
