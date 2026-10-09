import "server-only"

import { captureServerEvent } from "@/lib/analytics/posthog-server"
import { monthlyPriceNok } from "@/lib/affiliate/commission"
import type { PriceCohort } from "@/lib/billing/plans"
import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * «Fullført betaling» — bedriften ble betalende for første gang.
 *
 * Kalles fra billing-synken (lib/billing/sync.ts) KUN av den som vant den
 * betingede stemplingen av company_billing.first_paid_at (db/114). Idempotens
 * ligger altså i databasen, ikke her: webhook-retry, reconcile og kappløpet
 * webhook ↔ confirm-checkout gir fortsatt ett event. past_due → active
 * (dunning-gjenoppretting) kommer aldri hit — stempelet står alt.
 *
 * distinct_id = eldste admin i bedriften (samme pseudonym som klienten
 * identifiserer med), så eventet lander på personen som startet prøven.
 * Best-effort: kaster aldri.
 */
export async function reportPaymentCompleted(input: {
  companyId: string
  subscriptionId: string
  planKey: string | null
  interval: string | null
  cohort: PriceCohort | null
  /** Bedriften hadde en prøveperiode før den ble betalende. */
  fromTrial: boolean
}): Promise<void> {
  try {
    const admin = createAdminClient()

    const [{ data: adminUser }, { data: company }] = await Promise.all([
      admin
        .from("users")
        .select("id")
        .eq("company_id", input.companyId)
        .eq("role", "admin")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      admin
        .from("companies")
        .select("utm_source, utm_medium, utm_campaign, acquisition_click_network")
        .eq("id", input.companyId)
        .maybeSingle(),
    ])

    // Kolonnene fra db/114 kan mangle (42703) — da er company null, og vi
    // sender eventet uten kilde i stedet for å droppe det.
    const utm = (company ?? {}) as {
      utm_source?: string | null
      utm_medium?: string | null
      utm_campaign?: string | null
      acquisition_click_network?: string | null
    }

    await captureServerEvent({
      distinctId: adminUser?.id ?? `company:${input.companyId}`,
      event: "betaling_fullfort",
      properties: {
        company_id: input.companyId,
        abonnement_id: input.subscriptionId,
        plan: input.planKey,
        intervall: input.interval,
        kohort: input.cohort,
        kilde: input.fromTrial ? "prove" : "direkte",
        mrr_nok: monthlyPriceNok(input.planKey, input.interval, input.cohort ?? "current"),
        utm_source: utm.utm_source ?? null,
        utm_medium: utm.utm_medium ?? null,
        utm_campaign: utm.utm_campaign ?? null,
        annonsenett: utm.acquisition_click_network ?? null,
      },
    })
  } catch (error) {
    await logServerError({
      message: "PostHog: kunne ikke sende betaling_fullfort",
      error,
      level: "warning",
      source: "server",
      route: "reportPaymentCompleted",
      companyId: input.companyId,
      context: { subscriptionId: input.subscriptionId },
    })
  }
}
