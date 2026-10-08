import { NextResponse } from "next/server"

import { getUsageSummary, requireCompanyAdmin } from "@/lib/billing/guards"
import { isRetentionOfferAvailable } from "@/lib/billing/cancellation"
import { RETENTION_OFFER_PERCENT } from "@/lib/billing/cancellation-reasons"
import { MODULE_PRICING, PLAN_LABELS, planPricingFor, seatPriceNokFor } from "@/lib/billing/plans"
import { getCompanyPriceCohort } from "@/lib/billing/price-cohort"
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

    // «For dyrt» i oppsigelsesdialogen utløser 50 % av neste måned — én gang
    // per firma, kun betalende på månedlig trekk.
    const retentionOfferAvailable = await isRetentionOfferAvailable(auth.context.companyId)

    const cohort = await getCompanyPriceCohort(auth.context.companyId)
    const planKey = summary.plan_key
    const interval = summary.billing_interval

    return NextResponse.json({
      ...summary,
      plan_label: planKey ? PLAN_LABELS[planKey] : null,
      // Planvelgeren viser prisene for bedriftens kohort (gammel/ny prisliste).
      price_cohort: cohort,
      pricing:
        planKey && interval
          ? planPricingFor(cohort)[planKey][interval]
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
      retention_offer: retentionOfferAvailable ? { percent_off: RETENTION_OFFER_PERCENT } : null,
      seat_price_nok: seatPriceNokFor(cohort),
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
