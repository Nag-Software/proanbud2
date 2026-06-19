import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { mapEnhetToProspect, searchBrregEnheter, type MappedProspect } from "@/lib/outreach/brreg"

// Importing several Brreg pages can take a while.
export const maxDuration = 60

const importSchema = z.object({
  naeringskoder: z.array(z.string().trim().min(1)).min(1).max(10),
  kommunenummer: z.string().trim().optional(),
  fraAntallAnsatte: z.number().int().min(0).optional(),
  tilAntallAnsatte: z.number().int().min(0).optional(),
  maxPages: z.number().int().min(1).max(10).optional(),
})

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = importSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel", details: parsed.error.flatten() }, { status: 400 })
  }

  const { naeringskoder, fraAntallAnsatte, tilAntallAnsatte } = parsed.data
  const maxPages = parsed.data.maxPages ?? 3

  // Brønnøysund requires kommunenummer to be exactly 4 digits. Extract digits so
  // "3801 (Holmestrand)" is forgiven, and reject anything that isn't 4 digits.
  let kommunenummer: string | undefined
  if (parsed.data.kommunenummer?.trim()) {
    const digits = parsed.data.kommunenummer.replace(/\D/g, "")
    if (digits.length !== 4) {
      return NextResponse.json({ error: "Kommunenummer må være 4 siffer (f.eks. 3801)." }, { status: 400 })
    }
    kommunenummer = digits
  }

  // Brønnøysund forbids filtering to 1–4 employees (privacy). Only 0 or 5+ allowed.
  const inForbiddenRange = (n?: number) => typeof n === "number" && n >= 1 && n <= 4
  if (inForbiddenRange(fraAntallAnsatte) || inForbiddenRange(tilAntallAnsatte)) {
    return NextResponse.json(
      { error: "Brønnøysund tillater ikke søk på 1–4 ansatte (personvern). Bruk 0, eller 5 eller mer." },
      { status: 400 }
    )
  }

  const admin = createAdminClient()

  // 1. Fetch entities from Brønnøysund, page by page.
  const mapped = new Map<string, MappedProspect>()
  let fetched = 0
  let skipped = 0
  try {
    for (let page = 0; page < maxPages; page++) {
      const result = await searchBrregEnheter({
        naeringskoder,
        kommunenummer,
        fraAntallAnsatte,
        tilAntallAnsatte,
        page,
        size: 100,
      })
      fetched += result.enheter.length
      for (const enhet of result.enheter) {
        const row = mapEnhetToProspect(enhet)
        if (!row) {
          skipped += 1
          continue
        }
        mapped.set(row.org_number, row) // dedupe within batch by org_number
      }
      if (page + 1 >= result.totalPages) break
    }
  } catch (error) {
    console.error("[outreach/import] brreg fetch failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Brønnøysund-import feilet" },
      { status: 502 }
    )
  }

  const orgNumbers = [...mapped.keys()]
  if (orgNumbers.length === 0) {
    return NextResponse.json({ fetched, skipped, existingCustomers: 0, imported: 0, duplicates: 0 })
  }

  // 2. Exclude companies that are already registered customers (dedupe by org_number).
  const { data: existingCompanies } = await admin
    .from("companies")
    .select("org_number")
    .in("org_number", orgNumbers)

  const existingCustomerOrgs = new Set(
    (existingCompanies ?? []).map((c) => c.org_number).filter(Boolean) as string[]
  )

  const toInsert = orgNumbers
    .filter((org) => !existingCustomerOrgs.has(org))
    .map((org) => mapped.get(org)!)

  // 3. Insert new prospects (skip ones already imported earlier).
  let imported = 0
  if (toInsert.length > 0) {
    const { data: inserted, error: insertError } = await admin
      .from("prospects")
      .upsert(toInsert, { onConflict: "org_number", ignoreDuplicates: true })
      .select("id")

    if (insertError) {
      console.error("[outreach/import] insert failed", insertError)
      return NextResponse.json({ error: "Kunne ikke lagre prospekter" }, { status: 500 })
    }
    imported = inserted?.length ?? 0
  }

  const duplicates = toInsert.length - imported

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "import_prospects",
    targetType: "prospects",
    metadata: {
      naeringskoder,
      kommunenummer: kommunenummer ?? null,
      fetched,
      imported,
      duplicates,
      existingCustomers: existingCustomerOrgs.size,
    },
  })

  return NextResponse.json({
    fetched,
    skipped,
    existingCustomers: existingCustomerOrgs.size,
    duplicates,
    imported,
  })
}
