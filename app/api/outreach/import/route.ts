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
  /** 2-digit fylke prefix codes, e.g. ["03","32"]. Filters post-fetch. */
  fylker: z.array(z.string().trim().min(2).max(2)).optional(),
  fraAntallAnsatte: z.number().int().min(0).optional(),
  tilAntallAnsatte: z.number().int().min(0).optional(),
  // How many companies to import this run.
  count: z.number().int().min(1).max(2000).optional(),
  // Only import companies that have email/phone registered in Brønnøysund.
  onlyWithContact: z.boolean().optional(),
})

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = importSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel", details: parsed.error.flatten() }, { status: 400 })
  }

  const { naeringskoder, fraAntallAnsatte, tilAntallAnsatte } = parsed.data
  const count = parsed.data.count ?? 100
  const onlyWithContact = parsed.data.onlyWithContact ?? false
  const fylker = parsed.data.fylker?.length ? parsed.data.fylker : undefined
  // Fetch more pages when filtering by fylke or contact-only, since both
  // reduce density and we need enough raw results to reach `count` matches.
  const maxPages = fylker
    ? 20
    : onlyWithContact
      ? Math.min(20, Math.max(Math.ceil(count / 25), 2))
      : Math.min(20, Math.ceil(count / 100))

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
        fraAntallAnsatte,
        tilAntallAnsatte,
        page,
        size: 100,
      })
      fetched += result.enheter.length
      for (const enhet of result.enheter) {
        const row = mapEnhetToProspect(enhet)
        if (!row) { skipped += 1; continue }
        if (onlyWithContact && !row.email && !row.phone) { skipped += 1; continue }
        if (fylker) {
          const knr = row.kommune_number
          if (!knr || !fylker.some((f) => knr.startsWith(f))) { skipped += 1; continue }
        }
        mapped.set(row.org_number, row) // dedupe within batch by org_number
      }
      if (mapped.size >= count) break
      if (page + 1 >= result.totalPages) break
    }
  } catch (error) {
    console.error("[outreach/import] brreg fetch failed", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Brønnøysund-import feilet" },
      { status: 502 }
    )
  }

  const orgNumbers = [...mapped.keys()].slice(0, count)
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

  // 3b. Backfill Brreg contact info onto prospects that were imported earlier
  // and still lack an email. Only fills when email IS NULL, so it never
  // overwrites manually-edited/enriched contacts or touches CRM status.
  let backfilled = 0
  const withContact = toInsert.filter((p) => p.email || p.phone)
  for (const p of withContact) {
    const { data: updated } = await admin
      .from("prospects")
      .update({
        email: p.email,
        phone: p.phone,
        enrichment_status: "enriched",
        updated_at: new Date().toISOString(),
      })
      .eq("org_number", p.org_number)
      .is("email", null)
      .select("id")
    if (updated && updated.length > 0) backfilled += 1
  }

  const duplicates = toInsert.length - imported

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "import_prospects",
    targetType: "prospects",
    metadata: {
      naeringskoder,
      fylker: fylker ?? null,
      fetched,
      imported,
      duplicates,
      backfilled,
      existingCustomers: existingCustomerOrgs.size,
    },
  })

  return NextResponse.json({
    fetched,
    skipped,
    existingCustomers: existingCustomerOrgs.size,
    duplicates,
    backfilled,
    imported,
  })
}
