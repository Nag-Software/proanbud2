import { NextResponse } from "next/server"
import { z } from "zod"

import { changeSubscriptionPlan, createSubscriptionCheckoutSession } from "@/lib/billing/checkout"
import { reconcileCompanyBillingFromStripe } from "@/lib/billing/confirm-checkout"
import { logServerError } from "@/lib/errors/log"
import {
  getMissingCorePriceEnvKeys,
  type BillingInterval,
  type PlanKey,
} from "@/lib/billing/plans"
import { requireCompanyAdmin } from "@/lib/billing/guards"
import { SubscriptionMissingError } from "@/lib/billing/stripe-helpers"
import { isStripeConfigured } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"
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

    const missingPriceKeys = getMissingCorePriceEnvKeys()
    if (missingPriceKeys.length > 0) {
      console.error("[stripe/checkout] mangler pris-miljøvariabler", missingPriceKeys)
      return NextResponse.json(
        { error: "Betaling er ikke ferdig konfigurert. Kontakt support." },
        { status: 500 }
      )
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

    // If the company already has a live subscription, change the plan in place
    // instead of creating a SECOND subscription (double-charge).
    const admin = createAdminClient()
    const { data: existingBilling } = await admin
      .from("company_billing")
      .select("stripe_subscription_id, status")
      .eq("company_id", auth.context.companyId)
      .maybeSingle()

    // Whenever a subscription id is on file, reconcile against Stripe FIRST so the
    // decision reflects reality, not a possibly-stale DB status: a missed delete
    // webhook leaves a dead sub (→ heals to canceled → fresh checkout), and a
    // past_due/dunning sub still counts as live (→ modify in place, never a
    // second subscription).
    let liveStatus: string | null = null
    if (existingBilling?.stripe_subscription_id) {
      liveStatus = await reconcileCompanyBillingFromStripe(auth.context.companyId)
    }
    const hasLiveSub =
      liveStatus !== null && ["trialing", "active", "past_due"].includes(liveStatus)

    if (hasLiveSub) {
      const result = await changeSubscriptionPlan({
        companyId: auth.context.companyId,
        plan: parsed.data.plan as PlanKey,
        interval: parsed.data.interval as BillingInterval,
      })
      return NextResponse.json({ changed: result.changed, status: result.status })
    }

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
    await logServerError({
      message: "Stripe checkout/planbytte feilet",
      error,
      source: "api",
      route: "/api/stripe/checkout",
    })
    if (error instanceof SubscriptionMissingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return NextResponse.json(
      { error: "Kunne ikke starte betaling. Prøv igjen senere." },
      { status: 500 }
    )
  }
}
