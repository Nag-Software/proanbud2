import { NextResponse } from "next/server"
import { z } from "zod"

import { toggleModuleOnSubscription } from "@/lib/billing/checkout"
import { getAuthenticatedCompanyContext, requireActiveSubscription } from "@/lib/billing/guards"
import type { ModuleKey } from "@/lib/billing/plans"

const bodySchema = z.object({
  moduleKey: z.enum(["timeforing"]),
  enabled: z.boolean(),
})

export async function POST(request: Request) {
  try {
    const auth = await requireActiveSubscription()
    if (!auth.ok) return auth.response

    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: "Ugyldig forespørsel." }, { status: 400 })
    }

    const result = await toggleModuleOnSubscription({
      companyId: auth.context.companyId,
      moduleKey: parsed.data.moduleKey as ModuleKey,
      enabled: parsed.data.enabled,
    })

    return NextResponse.json({ success: true, module: result })
  } catch (error) {
    console.error("[stripe/modules]", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke oppdatere modul." },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const auth = await getAuthenticatedCompanyContext()
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke hente moduler." },
      { status: 500 }
    )
  }
}
