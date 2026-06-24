import type Stripe from "stripe"

import { getSubscriptionPeriodBounds } from "@/lib/billing/stripe-helpers"
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

function resolveBasePlanFromSubscription(
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

  const payload = {
    company_id: input.companyId,
    stripe_customer_id: input.customerId,
    stripe_subscription_id: input.subscription.id,
    plan_key: planKey,
    billing_interval: interval,
    status: input.subscription.status as BillingStatus,
    trial_ends_at: toIso(input.subscription.trial_end),
    current_period_start: toIso(period.start),
    current_period_end: toIso(period.end),
    quota_limit: quotaForPlan(planKey),
    included_seats: includedSeatsForPlan(planKey),
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
    // still carrying the paid 19 kr integrasjoner module item, remove that item
    // so they are not double-charged for a feature the plan already includes.
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

export async function getCompanyIdFromStripeMetadata(
  metadata: Stripe.Metadata | null | undefined
): Promise<string | null> {
  const companyId = metadata?.company_id?.trim()
  return companyId || null
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

export async function syncSeatQuantity(companyId: string) {
  const admin = createAdminClient()
  const stripe = getStripe()

  const { data: billing } = await admin
    .from("company_billing")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle()

  if (!billing?.stripe_subscription_id) return

  const billableSeats = await countBillableSeats(companyId)
  const included =
    billing.included_seats ??
    includedSeatsForPlan(billing.plan_key as PlanKey | null)
  const seatsToCharge = chargeableSeats(billableSeats, included)

  const subscription = await fetchSubscription(billing.stripe_subscription_id)
  let seatItemId = billing.stripe_seat_subscription_item_id

  const existingSeatItem = subscription.items.data.find(
    (item) => item.price.metadata?.kind === "seat"
  )

  if (seatsToCharge === 0) {
    if (existingSeatItem) {
      await stripe.subscriptionItems.del(existingSeatItem.id)
      seatItemId = null
    }
  } else if (existingSeatItem) {
    await stripe.subscriptionItems.update(existingSeatItem.id, {
      quantity: seatsToCharge,
    })
    seatItemId = existingSeatItem.id
  } else {
    const { getSeatPriceId } = await import("@/lib/billing/plans")
    const created = await stripe.subscriptionItems.create({
      subscription: billing.stripe_subscription_id,
      price: getSeatPriceId(),
      quantity: seatsToCharge,
    })
    seatItemId = created.id
  }

  await admin
    .from("company_billing")
    .update({
      stripe_seat_subscription_item_id: seatItemId,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", companyId)
}
