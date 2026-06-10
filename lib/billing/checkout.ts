import type Stripe from "stripe"

import {
  getModulePriceId,
  getStripePriceId,
  TRIAL_DAYS,
  type BillingInterval,
  type ModuleKey,
  type PlanKey,
} from "@/lib/billing/plans"
import { ensureCompanyBillingRow } from "@/lib/billing/sync"
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
