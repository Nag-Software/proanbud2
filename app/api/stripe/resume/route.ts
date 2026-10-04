import { NextResponse } from "next/server"

import { requireCompanyAdmin } from "@/lib/billing/guards"
import { CancellationNotAllowedError, resumeSubscription } from "@/lib/billing/cancellation"
import { SubscriptionMissingError } from "@/lib/billing/stripe-helpers"
import { logServerError } from "@/lib/errors/log"

/** Angre en oppsigelse før perioden er ute. */
export async function POST() {
  try {
    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    await resumeSubscription(auth.context.companyId)
    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof CancellationNotAllowedError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("[stripe/resume]", error)
    await logServerError({
      message: "Gjenopptak av abonnement feilet",
      error,
      source: "api",
      route: "/api/stripe/resume",
    })
    if (error instanceof SubscriptionMissingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return NextResponse.json(
      { error: "Kunne ikke gjenoppta abonnementet. Prøv igjen om litt." },
      { status: 500 }
    )
  }
}
