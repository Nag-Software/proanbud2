import { NextResponse } from "next/server"

import { createTrialSubscription, TrialAlreadyUsedError } from "@/lib/billing/checkout"
import { requireCompanyAdmin } from "@/lib/billing/guards"
import { getMissingCorePriceEnvKeys } from "@/lib/billing/plans"
import { logServerError } from "@/lib/errors/log"
import { isStripeConfigured } from "@/lib/stripe/server"
import { createClient } from "@/lib/supabase/server"

/**
 * Starter den kortfrie 14-dagers Proff-prøven for bedriften — ingen Checkout.
 * Brukes av /onboarding/abonnement og betalingssiden når prøven aldri er brukt;
 * /api/companies starter den samme prøven automatisk ved firmaopprettelse.
 */
export async function POST() {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Stripe er ikke konfigurert." }, { status: 500 })
    }

    const missingPriceKeys = getMissingCorePriceEnvKeys()
    if (missingPriceKeys.length > 0) {
      console.error("[billing/start-trial] mangler pris-miljøvariabler", missingPriceKeys)
      return NextResponse.json(
        { error: "Betaling er ikke ferdig konfigurert. Kontakt support." },
        { status: 500 }
      )
    }

    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    const supabase = await createClient()
    const { data: company } = await supabase
      .from("companies")
      .select("name, org_number")
      .eq("id", auth.context.companyId)
      .maybeSingle()

    const result = await createTrialSubscription({
      companyId: auth.context.companyId,
      email: auth.context.email,
      companyName: company?.name || auth.context.fullName,
      fullName: auth.context.fullName,
      orgNumber: company?.org_number,
    })

    return NextResponse.json({ status: result.status })
  } catch (error) {
    if (error instanceof TrialAlreadyUsedError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    console.error("[billing/start-trial]", error)
    await logServerError({
      message: "Kortfri trial-start feilet",
      error,
      source: "api",
      route: "/api/billing/start-trial",
    })
    return NextResponse.json(
      { error: "Kunne ikke starte prøveperioden. Prøv igjen senere." },
      { status: 500 }
    )
  }
}
