import { NextResponse } from "next/server"

import { requireCompanyAdmin } from "@/lib/billing/guards"
import { recoverFromDeadSubscription } from "@/lib/billing/confirm-checkout"
import { upsertCompanyBillingFromSubscription } from "@/lib/billing/sync"
import {
  isStripeResourceMissing,
  SubscriptionMissingError,
} from "@/lib/billing/stripe-helpers"
import { getStripe } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

export async function POST() {
  try {
    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    const admin = createAdminClient()
    const { data: billing } = await admin
      .from("company_billing")
      .select("stripe_subscription_id, stripe_customer_id, status")
      .eq("company_id", auth.context.companyId)
      .maybeSingle()

    if (!billing?.stripe_subscription_id || billing.status !== "trialing") {
      return NextResponse.json(
        { error: "Ingen aktiv prøveperiode å avslutte." },
        { status: 400 }
      )
    }

    const stripe = getStripe()
    let updated
    try {
      updated = await stripe.subscriptions.update(billing.stripe_subscription_id, {
        trial_end: "now",
      })
    } catch (error) {
      if (isStripeResourceMissing(error)) {
        await recoverFromDeadSubscription(auth.context.companyId)
        throw new SubscriptionMissingError()
      }
      throw error
    }

    await upsertCompanyBillingFromSubscription({
      companyId: auth.context.companyId,
      customerId: billing.stripe_customer_id!,
      subscription: updated,
    })

    return NextResponse.json({ success: true, status: updated.status })
  } catch (error) {
    console.error("[stripe/end-trial]", error)
    if (error instanceof SubscriptionMissingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return NextResponse.json(
      { error: "Kunne ikke avslutte prøveperiode. Prøv igjen senere." },
      { status: 500 }
    )
  }
}
