import { NextResponse } from "next/server"

import { requireCompanyAdmin } from "@/lib/billing/guards"
import {
  acceptRetentionDiscount,
  cancelSubscriptionWithReason,
  CancellationNotAllowedError,
} from "@/lib/billing/cancellation"
import { validateCancellationAnswer } from "@/lib/billing/cancellation-reasons"
import { SubscriptionMissingError } from "@/lib/billing/stripe-helpers"
import { logServerError } from "@/lib/errors/log"

/**
 * Avslutt abonnement — grunnen er obligatorisk. `action: "accept_discount"`
 * tar i stedet imot 50 %-tilbudet (kun ved «For dyrt») og beholder abonnementet.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    const body = (await request.json().catch(() => null)) as { action?: unknown } | null
    const validation = validateCancellationAnswer(body)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const input = {
      companyId: auth.context.companyId,
      userId: auth.context.userId,
      answer: validation.answer,
    }

    if (body?.action === "accept_discount") {
      await acceptRetentionDiscount(input)
      return NextResponse.json({ success: true, outcome: "discount_accepted" })
    }

    const { cancelAt } = await cancelSubscriptionWithReason(input)
    return NextResponse.json({ success: true, outcome: "canceled", cancel_at: cancelAt })
  } catch (error) {
    if (error instanceof CancellationNotAllowedError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error("[stripe/cancel]", error)
    await logServerError({
      message: "Avslutting av abonnement feilet",
      error,
      source: "api",
      route: "/api/stripe/cancel",
    })
    if (error instanceof SubscriptionMissingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return NextResponse.json(
      { error: "Kunne ikke avslutte abonnementet. Prøv igjen om litt." },
      { status: 500 }
    )
  }
}
