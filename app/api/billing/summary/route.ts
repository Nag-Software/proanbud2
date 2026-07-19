import { NextResponse } from "next/server"

import { getUsageSummary, requireCompanyAdmin } from "@/lib/billing/guards"
import { MODULE_PRICING, PLAN_LABELS, PLAN_PRICING, SEAT_PRICE_NOK } from "@/lib/billing/plans"
import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { getWelcomeDiscount, WELCOME_DISCOUNT_PERCENT } from "@/lib/billing/welcome-discount"

export async function GET() {
  try {
    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    const summary = await getUsageSummary(auth.context.companyId)

    const admin = createAdminClient()
    // Velkomstbonusen lever på company_billing, ikke i usage-RPC-en — hentes
    // her så betalingssiden kan vise koden brukeren fikk på e-post.
    const welcomeDiscount = await getWelcomeDiscount(auth.context.companyId)
    const { data: modules } = await admin
      .from("company_modules")
      .select("module_key, enabled_at")
      .eq("company_id", auth.context.companyId)

    const planKey = summary.plan_key
    const interval = summary.billing_interval

    return NextResponse.json({
      ...summary,
      plan_label: planKey ? PLAN_LABELS[planKey] : null,
      pricing:
        planKey && interval
          ? PLAN_PRICING[planKey][interval]
          : null,
      modules: (modules ?? []).map((m) => ({
        ...m,
        monthly_nok: MODULE_PRICING[m.module_key as keyof typeof MODULE_PRICING] ?? null,
      })),
      welcome_discount: welcomeDiscount
        ? {
            code: welcomeDiscount.code,
            percent_off: WELCOME_DISCOUNT_PERCENT,
            applied: Boolean(welcomeDiscount.appliedAt),
          }
        : null,
      seat_price_nok: SEAT_PRICE_NOK,
      overage_unit_nok: 9.5,
    })
  } catch (error) {
    console.error("[billing/summary]", error)
    await logServerError({
      message: "Henting av abonnement-sammendrag feilet",
      error,
      source: "api",
      route: "/api/billing/summary",
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke hente abonnement." },
      { status: 500 }
    )
  }
}
