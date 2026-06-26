import { NextResponse } from "next/server"
import { z } from "zod"

import {
  confirmCheckoutSession,
  reconcileCompanyBillingFromStripe,
} from "@/lib/billing/confirm-checkout"
import { requireCompanyAdmin } from "@/lib/billing/guards"
import { isActiveSubscriptionStatus } from "@/lib/billing/plans"
import { logServerError } from "@/lib/errors/log"

const bodySchema = z.object({
  sessionId: z.string().min(1).optional(),
  reconcile: z.boolean().optional(),
})

export async function POST(request: Request) {
  try {
    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 })
    }

    let status: string | null = null

    if (parsed.data.sessionId) {
      status = await confirmCheckoutSession(
        parsed.data.sessionId,
        auth.context.companyId
      )
    } else if (parsed.data.reconcile) {
      status = await reconcileCompanyBillingFromStripe(auth.context.companyId)
    } else {
      return NextResponse.json({ error: "Mangler sessionId eller reconcile." }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      status,
      isActive: isActiveSubscriptionStatus(status),
    })
  } catch (error) {
    console.error("[stripe/confirm-checkout]", error)
    await logServerError({
      message: "Bekreftelse av Stripe checkout feilet",
      error,
      source: "api",
      route: "/api/stripe/confirm-checkout",
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke bekrefte checkout." },
      { status: 500 }
    )
  }
}
