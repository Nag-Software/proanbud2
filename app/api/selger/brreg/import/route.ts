import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { mapEnhetToProspect, type BrregEnhet } from "@/lib/outreach/brreg"

const schema = z.object({ orgNumber: z.string().regex(/^\d{9}$/) })

/** Importer ETT firma fra Brønnøysund (fra «Nytt lead»-søket) rett i innboksen. */
export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig organisasjonsnummer" }, { status: 400 })
  }

  try {
    const res = await fetch(
      `https://data.brreg.no/enhetsregisteret/api/enheter/${parsed.data.orgNumber}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    )
    if (!res.ok) {
      return NextResponse.json({ error: "Fant ikke firmaet i Brønnøysund" }, { status: 404 })
    }
    const enhet = (await res.json()) as BrregEnhet
    const row = mapEnhetToProspect(enhet)
    if (!row) {
      return NextResponse.json(
        { error: "Firmaet kan ikke importeres (konkurs/under avvikling)" },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const { data, error } = await admin
      .from("prospects")
      .upsert(row, { onConflict: "org_number", ignoreDuplicates: true })
      .select("id")
      .maybeSingle()

    if (error) throw error

    // ignoreDuplicates → null når firmaet allerede fantes; hent id-en.
    let prospectId = data?.id ?? null
    if (!prospectId) {
      const { data: existing } = await admin
        .from("prospects")
        .select("id")
        .eq("org_number", row.org_number)
        .maybeSingle()
      prospectId = existing?.id ?? null
    }

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "import_prospects",
      targetType: "prospect",
      targetId: prospectId,
      metadata: { companyName: row.name, orgNumber: row.org_number, mode: "single" },
    })

    return NextResponse.json({ prospectId, alreadyExisted: !data })
  } catch (error) {
    console.error("[selger/brreg/import]", error)
    await logServerError({
      message: "Enkelt-import fra Brønnøysund feilet",
      error,
      source: "api",
      route: "POST /api/selger/brreg/import",
      context: { orgNumber: parsed.data.orgNumber, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Importen feilet — prøv igjen" }, { status: 502 })
  }
}
