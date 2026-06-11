import { NextResponse } from "next/server"
import { z } from "zod"

import { createSubscriptionCheckoutSession } from "@/lib/billing/checkout"
import type { BillingInterval, PlanKey } from "@/lib/billing/plans"
import { requireCompanyAdmin } from "@/lib/billing/guards"
import { isStripeConfigured } from "@/lib/stripe/server"
import { createClient } from "@/lib/supabase/server"

const bodySchema = z.object({
  plan: z.enum(["mini", "proff"]),
  interval: z.enum(["month", "year"]),
  trial: z.boolean().optional(),
  successPath: z.string().optional(),
  cancelPath: z.string().optional(),
})

function getBaseUrl(request: Request) {
  const origin = request.headers.get("origin")
  if (origin) return origin
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (configured) return configured.replace(/\/$/, "")
  const host = request.headers.get("host")
  if (!host) return "http://localhost:3000"
  const protocol = process.env.NODE_ENV === "development" ? "http" : "https"
  return `${protocol}://${host}`
}

export async function POST(request: Request) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json({ error: "Stripe er ikke konfigurert." }, { status: 500 })
    }

    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: company } = await supabase
      .from("companies")
      .select("name, org_number")
      .eq("id", auth.context.companyId)
      .maybeSingle()

    const session = await createSubscriptionCheckoutSession({
      companyId: auth.context.companyId,
      email: auth.context.email,
      companyName: company?.name || auth.context.fullName,
      fullName: auth.context.fullName,
      orgNumber: company?.org_number,
      plan: parsed.data.plan as PlanKey,
      interval: parsed.data.interval as BillingInterval,
      trial: parsed.data.trial,
      successPath: parsed.data.successPath,
      cancelPath: parsed.data.cancelPath,
      baseUrl: getBaseUrl(request),
    })

    return NextResponse.json({ url: session.url })
  } catch (error) {
    console.error("[stripe/checkout]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke starte betaling." },
      { status: 500 }
    )
  }
}
