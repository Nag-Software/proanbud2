import { NextResponse } from "next/server"

import { requireCompanyAdmin } from "@/lib/billing/guards"
import { fetchSubscription, upsertCompanyBillingFromSubscription } from "@/lib/billing/sync"
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
    const updated = await stripe.subscriptions.update(billing.stripe_subscription_id, {
      trial_end: "now",
    })

    await upsertCompanyBillingFromSubscription({
      companyId: auth.context.companyId,
      customerId: billing.stripe_customer_id!,
      subscription: updated,
    })

    return NextResponse.json({ success: true, status: updated.status })
  } catch (error) {
    console.error("[stripe/end-trial]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke avslutte prøveperiode." },
      { status: 500 }
    )
  }
}
