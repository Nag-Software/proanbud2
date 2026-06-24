import type Stripe from "stripe"

import {
  getModulePriceId,
  getStripePriceId,
  isActiveSubscriptionStatus,
  TRIAL_DAYS,
  type BillingInterval,
  type ModuleKey,
  type PlanKey,
} from "@/lib/billing/plans"
import {
  ensureCompanyBillingRow,
  fetchSubscription,
  resolveBasePlanFromSubscription,
  syncModulesFromSubscription,
  syncSeatQuantity,
  upsertCompanyBillingFromSubscription,
} from "@/lib/billing/sync"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

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
    return billing.stripe_customer_id
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
    throw new Error(
      "Bedriften har allerede et aktivt abonnement. Bruk planbytte i stedet for ny betaling."
    )
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

  const subscription = await fetchSubscription(billing.stripe_subscription_id)
  const { baseItemId } = resolveBasePlanFromSubscription(subscription)
  if (!baseItemId) {
    throw new Error("Fant ikke abonnementets grunnplan")
  }

  await stripe.subscriptions.update(billing.stripe_subscription_id, {
    items: [{ id: baseItemId, price: getStripePriceId(input.plan, input.interval) }],
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
    .select("stripe_subscription_id, status")
    .eq("company_id", input.companyId)
    .maybeSingle()

  if (!billing?.stripe_subscription_id) {
    throw new Error("Aktivt abonnement mangler")
  }

  const { data: existingModule } = await admin
    .from("company_modules")
    .select("*")
    .eq("company_id", input.companyId)
    .eq("module_key", input.moduleKey)
    .maybeSingle()

  if (input.enabled) {
    if (existingModule?.stripe_subscription_item_id) {
      return existingModule
    }

    const item = await stripe.subscriptionItems.create({
      subscription: billing.stripe_subscription_id,
      price: getModulePriceId(input.moduleKey),
      quantity: 1,
    })

    const row = {
      company_id: input.companyId,
      module_key: input.moduleKey,
      enabled_at: new Date().toISOString(),
      stripe_subscription_item_id: item.id,
    }

    await admin.from("company_modules").upsert(row, {
      onConflict: "company_id,module_key",
    })

    return row
  }

  if (existingModule?.stripe_subscription_item_id) {
    await stripe.subscriptionItems.del(existingModule.stripe_subscription_item_id)
  }

  await admin
    .from("company_modules")
    .delete()
    .eq("company_id", input.companyId)
    .eq("module_key", input.moduleKey)

  return null
}
