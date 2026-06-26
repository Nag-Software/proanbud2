import type Stripe from "stripe"

import {
  getModulePriceId,
  getSeatPriceId,
  getStripePriceId,
  isActiveSubscriptionStatus,
  TRIAL_DAYS,
  type BillingInterval,
  type ModuleKey,
  type PlanKey,
} from "@/lib/billing/plans"
import { recoverFromDeadSubscription } from "@/lib/billing/confirm-checkout"
import {
  ensureCompanyBillingRow,
  fetchSubscription,
  markCompanyBillingCanceled,
  resolveBasePlanFromSubscription,
  syncModulesFromSubscription,
  syncSeatQuantity,
  upsertCompanyBillingFromSubscription,
} from "@/lib/billing/sync"
import {
  isStripeResourceMissing,
  SubscriptionMissingError,
} from "@/lib/billing/stripe-helpers"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Verify a company's stored subscription is still live in Stripe.
 * Returns the live Stripe status, or null when it is gone/dead (and self-heals
 * the DB row in that case). Used by the double-charge guards so a stale "active"
 * row left by a missed delete webhook can never block a fresh checkout.
 */
async function verifyStoredSubscriptionLive(
  companyId: string,
  subscriptionId: string
): Promise<string | null> {
  try {
    const sub = await fetchSubscription(subscriptionId)
    if (["trialing", "active", "past_due"].includes(sub.status)) return sub.status
    await markCompanyBillingCanceled(companyId)
    return null
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      await markCompanyBillingCanceled(companyId)
      return null
    }
    throw error
  }
}

export type CheckoutInput = {
  companyId: string
  email: string
  companyName: string
  fullName: string
  orgNumber?: string | null
  plan: PlanKey
  interval: BillingInterval
  trial?: boolean
  successPath?: string
  cancelPath?: string
  baseUrl: string
}

async function findOrCreateCustomer(input: {
  companyId: string
  email: string
  companyName: string
  fullName: string
  orgNumber?: string | null
}): Promise<string> {
  const stripe = getStripe()
  const admin = createAdminClient()

  const { data: billing } = await admin
    .from("company_billing")
    .select("stripe_customer_id")
    .eq("company_id", input.companyId)
    .maybeSingle()

  if (billing?.stripe_customer_id) {
    // Verify the stored customer still exists in Stripe before trusting it; a
    // deleted customer would otherwise resurface as resource_missing at checkout.
    try {
      const customer = await stripe.customers.retrieve(billing.stripe_customer_id)
      if (!(customer as Stripe.DeletedCustomer).deleted) {
        return billing.stripe_customer_id
      }
    } catch (error) {
      if (!isStripeResourceMissing(error)) throw error
    }
    await admin
      .from("company_billing")
      .update({ stripe_customer_id: null, updated_at: new Date().toISOString() })
      .eq("company_id", input.companyId)
  }

  const search = await stripe.customers.search({
    query: `metadata['company_id']:'${input.companyId}'`,
    limit: 1,
  })

  if (search.data[0]) {
    const customerId = search.data[0].id
    await admin.from("company_billing").upsert({
      company_id: input.companyId,
      stripe_customer_id: customerId,
      status: "incomplete",
    })
    return customerId
  }

  const customer = await stripe.customers.create({
    email: input.email,
    name: input.companyName || input.fullName || input.email,
    metadata: {
      company_id: input.companyId,
      user_name: input.fullName,
      ...(input.orgNumber ? { org_number: input.orgNumber } : {}),
    },
  })

  await ensureCompanyBillingRow(input.companyId)
  await admin
    .from("company_billing")
    .update({
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString(),
    })
    .eq("company_id", input.companyId)

  return customer.id
}

export async function createSubscriptionCheckoutSession(
  input: CheckoutInput
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe()
  await ensureCompanyBillingRow(input.companyId)

  // Safety net: never open a new checkout for a company that already has an
  // active/trialing subscription — that creates a SECOND live subscription and
  // double-charges. Plan changes must go through changeSubscriptionPlan; the
  // /api/stripe/checkout route branches on this before it ever calls us.
  const admin = createAdminClient()
  const { data: existingBilling } = await admin
    .from("company_billing")
    .select("stripe_subscription_id, status")
    .eq("company_id", input.companyId)
    .maybeSingle()
  if (
    existingBilling?.stripe_subscription_id &&
    isActiveSubscriptionStatus(existingBilling.status)
  ) {
    // Only block if Stripe confirms the subscription is genuinely live. A stale
    // "active" row (missed delete webhook) self-heals here and falls through to
    // a fresh checkout instead of locking the company out of re-subscribing.
    const liveStatus = await verifyStoredSubscriptionLive(
      input.companyId,
      existingBilling.stripe_subscription_id
    )
    if (liveStatus) {
      throw new Error(
        "Bedriften har allerede et aktivt abonnement. Bruk planbytte i stedet for ny betaling."
      )
    }
  }

  const customerId = await findOrCreateCustomer({
    companyId: input.companyId,
    email: input.email,
    companyName: input.companyName,
    fullName: input.fullName,
    orgNumber: input.orgNumber,
  })

  // Base plan only — seat add-ons are added later via syncSeatQuantity when employees are invited.
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    {
      price: getStripePriceId(input.plan, input.interval),
      quantity: 1,
    },
  ]

  const successPath = input.successPath ?? "/onboarding/velkommen"
  const cancelPath = input.cancelPath ?? "/onboarding/abonnement"

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: "subscription",
    customer: customerId,
    locale: "nb",
    line_items: lineItems,
    success_url: `${input.baseUrl}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${input.baseUrl}${cancelPath}`,
    metadata: {
      company_id: input.companyId,
      plan_key: input.plan,
      billing_interval: input.interval,
    },
    subscription_data: {
      metadata: {
        company_id: input.companyId,
        plan_key: input.plan,
        billing_interval: input.interval,
      },
      ...(input.trial
        ? {
            trial_period_days: TRIAL_DAYS,
            trial_settings: {
              end_behavior: { missing_payment_method: "cancel" },
            },
          }
        : {}),
    },
    payment_method_collection: "always",
    allow_promotion_codes: true,
    billing_address_collection: "auto",
    customer_update: {
      address: "auto",
      name: "auto",
    },
  }

  return stripe.checkout.sessions.create(sessionParams)
}

/**
 * Switch an existing subscription to a different plan/interval IN PLACE.
 *
 * The in-app "Oppgrader til Proff" button must never open a new checkout when
 * the company already has a subscription — that would create a second live
 * subscription and double-charge (incl. a standalone integrasjoner module that
 * is bundled into Proff). Instead we swap the base subscription item's price
 * with proration, mirroring how toggleModuleOnSubscription edits the live
 * subscription. Returns { changed:false } when already on that plan+interval.
 */
export async function changeSubscriptionPlan(input: {
  companyId: string
  plan: PlanKey
  interval: BillingInterval
}): Promise<{ changed: boolean; status: string }> {
  const stripe = getStripe()
  const admin = createAdminClient()

  const { data: billing } = await admin
    .from("company_billing")
    .select("stripe_subscription_id, stripe_customer_id, status, plan_key, billing_interval")
    .eq("company_id", input.companyId)
    .maybeSingle()

  if (!billing?.stripe_subscription_id || !billing.stripe_customer_id) {
    throw new Error("Aktivt abonnement mangler")
  }

  // Already on the requested plan + interval — nothing to do.
  if (billing.plan_key === input.plan && billing.billing_interval === input.interval) {
    return { changed: false, status: billing.status ?? "active" }
  }

  try {
    const subscription = await fetchSubscription(billing.stripe_subscription_id)
    const { baseItemId } = resolveBasePlanFromSubscription(subscription)
    if (!baseItemId) {
      throw new Error("Fant ikke abonnementets grunnplan")
    }

    const intervalChanged = billing.billing_interval !== input.interval

    // Swap the base item's price. When the interval changes, also re-price every
    // add-on (seat/module) item to the new interval — Stripe rejects a
    // subscription that mixes monthly and yearly items (prices_in_different_intervals).
    const items: Stripe.SubscriptionUpdateParams.Item[] = [
      { id: baseItemId, price: getStripePriceId(input.plan, input.interval) },
    ]
    if (intervalChanged) {
      for (const item of subscription.items.data) {
        if (item.id === baseItemId) continue
        const kind = item.price.metadata?.kind
        if (kind === "seat") {
          items.push({ id: item.id, price: getSeatPriceId(input.interval) })
        } else if (kind === "module") {
          const moduleKey = item.price.metadata?.module_key
          if (moduleKey) {
            items.push({
              id: item.id,
              price: getModulePriceId(moduleKey as ModuleKey, input.interval),
            })
          }
        }
      }
    }

    // No idempotency key: the early-return above already collapses a redundant
    // same-state change, and a deterministic key would REPLAY a cached response
    // for a legitimate repeat transition (A→B→A→B) within Stripe's 24h key window,
    // silently no-op'ing the second upgrade.
    await stripe.subscriptions.update(billing.stripe_subscription_id, {
      items,
      proration_behavior: "create_prorations",
      metadata: {
        company_id: input.companyId,
        plan_key: input.plan,
        billing_interval: input.interval,
      },
    })

    // Re-fetch with expanded prices, then re-sync. Order matters: billing first
    // (refreshes plan_key + included_seats), then modules, then seats.
    const fresh = await fetchSubscription(billing.stripe_subscription_id)
    await upsertCompanyBillingFromSubscription({
      companyId: input.companyId,
      customerId: billing.stripe_customer_id,
      subscription: fresh,
    })
    // Drops the standalone integrasjoner module item when upgrading to Proff
    // (bundled in the plan) so it is not billed on top.
    await syncModulesFromSubscription(input.companyId, fresh)
    // Included seats differ between plans (Mini 0 / Proff 5) → recompute charges.
    await syncSeatQuantity(input.companyId)

    return { changed: true, status: fresh.status }
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      // Subscription was deleted out-of-band — heal the row and surface a
      // re-subscribe path instead of a raw 500.
      await recoverFromDeadSubscription(input.companyId)
      throw new SubscriptionMissingError()
    }
    throw error
  }
}

export async function toggleModuleOnSubscription(input: {
  companyId: string
  moduleKey: ModuleKey
  enabled: boolean
}) {
  const stripe = getStripe()
  const admin = createAdminClient()

  const { data: billing } = await admin
    .from("company_billing")
    .select("stripe_subscription_id, status, billing_interval")
    .eq("company_id", input.companyId)
    .maybeSingle()

  if (!billing?.stripe_subscription_id) {
    throw new Error("Aktivt abonnement mangler")
  }

  const interval = (billing.billing_interval as BillingInterval | null) ?? "month"

  try {
    if (input.enabled) {
      // Idempotent against STRIPE state (not just the DB row): re-fetch the
      // subscription and reuse any existing item for this module so a retry or
      // concurrent enable can't create a second, double-charged item.
      const subscription = await fetchSubscription(billing.stripe_subscription_id)
      const existingItem = subscription.items.data.find(
        (item) =>
          item.price.metadata?.kind === "module" &&
          item.price.metadata?.module_key === input.moduleKey
      )

      // No idempotency key: the existingItem reuse above already prevents a
      // duplicate item on retry/concurrent enable. A deterministic key would
      // REPLAY a cached create after an intervening disable deleted the item,
      // re-linking a dead item id (module granted but never billed).
      const itemId =
        existingItem?.id ??
        (
          await stripe.subscriptionItems.create({
            subscription: billing.stripe_subscription_id,
            price: getModulePriceId(input.moduleKey, interval),
            quantity: 1,
          })
        ).id

      const row = {
        company_id: input.companyId,
        module_key: input.moduleKey,
        enabled_at: new Date().toISOString(),
        stripe_subscription_item_id: itemId,
      }

      await admin.from("company_modules").upsert(row, {
        onConflict: "company_id,module_key",
      })

      return row
    }

    // Disable: remove every Stripe item for this module (guards against dupes),
    // then drop the DB row.
    const subscription = await fetchSubscription(billing.stripe_subscription_id)
    const moduleItems = subscription.items.data.filter(
      (item) =>
        item.price.metadata?.kind === "module" &&
        item.price.metadata?.module_key === input.moduleKey
    )
    for (const item of moduleItems) {
      try {
        await stripe.subscriptionItems.del(item.id)
      } catch (error) {
        if (!isStripeResourceMissing(error)) throw error
      }
    }

    await admin
      .from("company_modules")
      .delete()
      .eq("company_id", input.companyId)
      .eq("module_key", input.moduleKey)

    return null
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      await recoverFromDeadSubscription(input.companyId)
      throw new SubscriptionMissingError()
    }
    throw error
  }
}
