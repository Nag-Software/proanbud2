import { NextResponse } from "next/server"
import { z } from "zod"

import { toggleModuleOnSubscription } from "@/lib/billing/checkout"
import { requireActiveSubscription, requireCompanyAdmin } from "@/lib/billing/guards"
import type { ModuleKey } from "@/lib/billing/plans"
import { SubscriptionMissingError } from "@/lib/billing/stripe-helpers"
import { logServerError } from "@/lib/errors/log"

const bodySchema = z.object({
  moduleKey: z.enum(["timeforing", "dokumenter", "integrasjoner", "meldinger_ki", "kjorebok"]),
  enabled: z.boolean(),
})

export async function POST(request: Request) {
  try {
    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    const active = await requireActiveSubscription()
    if (!active.ok) return active.response

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 })
    }

    // Integrasjoner is bundled into Proff — never let a Proff company add the
    // paid 19 kr module on top (the UI hides the toggle, but enforce it here too
    // so a direct POST cannot create a duplicate, double-charging subscription item).
    if (
      parsed.data.enabled &&
      parsed.data.moduleKey === "integrasjoner" &&
      auth.context.planKey === "proff"
    ) {
      return NextResponse.json(
        { error: "Integrasjoner er allerede inkludert i Proff-abonnementet." },
        { status: 400 }
      )
    }

    const result = await toggleModuleOnSubscription({
      companyId: auth.context.companyId,
      moduleKey: parsed.data.moduleKey as ModuleKey,
      enabled: parsed.data.enabled,
    })

    return NextResponse.json({ success: true, module: result })
  } catch (error) {
    console.error("[stripe/modules]", error)
    await logServerError({
      message: "Oppdatering av modul på abonnement feilet",
      error,
      source: "api",
      route: "/api/stripe/modules",
    })
    if (error instanceof SubscriptionMissingError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    return NextResponse.json(
      { error: "Kunne ikke oppdatere modul. Prøv igjen senere." },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const auth = await requireCompanyAdmin()
    if (!auth.ok) return auth.response

    const { createAdminClient } = await import("@/lib/supabase/admin")
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("company_modules")
      .select("module_key, enabled_at")
      .eq("company_id", auth.context.companyId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ modules: data ?? [] })
  } catch (error) {
    console.error("[stripe/modules GET]", error)
    await logServerError({
      message: "Henting av moduler feilet",
      error,
      source: "api",
      route: "/api/stripe/modules",
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke hente moduler." },
      { status: 500 }
    )
  }
}
