import { getOveragePriceId, OVERAGE_UNIT_ORE } from "@/lib/billing/plans"
import { createAdminClient } from "@/lib/supabase/admin"
import { getStripe } from "@/lib/stripe/server"

export async function applyOverageToUpcomingInvoice(input: {
  companyId: string
  stripeCustomerId: string
  stripeSubscriptionId: string
  stripeInvoiceId?: string
  periodStart: string
  periodEnd: string
}) {
  const admin = createAdminClient()
  const stripe = getStripe()

  const { data: existingSnapshot } = await admin
    .from("billing_overage_snapshots")
    .select("id")
    .eq("company_id", input.companyId)
    .eq("period_start", input.periodStart)
    .eq("period_end", input.periodEnd)
    .maybeSingle()

  if (existingSnapshot) {
    return { applied: false, reason: "already_billed" as const }
  }

  const { data: billing } = await admin
    .from("company_billing")
    .select("quota_limit")
    .eq("company_id", input.companyId)
    .maybeSingle()

  const quotaLimit = billing?.quota_limit ?? 0

  const { count: usedCount, error: countError } = await admin
    .from("company_usage_events")
    .select("id", { count: "exact", head: true })
    .eq("company_id", input.companyId)
    .eq("event_type", "ai_tilbud")
    .gte("created_at", input.periodStart)
    .lt("created_at", input.periodEnd)

  if (countError) {
    throw new Error(countError.message)
  }

  const used = usedCount ?? 0
  const overage = Math.max(0, used - quotaLimit)

  if (overage === 0) {
    return { applied: false, reason: "no_overage" as const, used, quotaLimit }
  }

  await stripe.invoiceItems.create({
    customer: input.stripeCustomerId,
    subscription: input.stripeSubscriptionId,
    quantity: overage,
    pricing: {
      price: getOveragePriceId(),
    },
    description: `Overforbruk AI-tilbud (${overage} stk à 9,50 kr)`,
  })

  await admin.from("billing_overage_snapshots").insert({
    company_id: input.companyId,
    stripe_invoice_id: input.stripeInvoiceId ?? null,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    quota_limit: quotaLimit,
    used_count: used,
    overage_count: overage,
    unit_amount_ore: OVERAGE_UNIT_ORE,
  })

  return { applied: true, used, overage, quotaLimit }
}
