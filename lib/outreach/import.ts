// Reusable Brønnøysund → prospects importer.
//
// Extracted from app/api/outreach/import so it can be driven both by the manual
// admin import button AND by the daily cron, which auto-tops-up the prospect pool
// when it runs low so the outbound engine never starves for fresh leads.

import type { createAdminClient } from "@/lib/supabase/admin"
import { mapEnhetToProspect, searchBrregEnheter, type MappedProspect } from "@/lib/outreach/brreg"

type AdminClient = ReturnType<typeof createAdminClient>

export type ImportProspectsParams = {
  naeringskoder: string[]
  /** 2-digit fylke prefix codes, e.g. ["03","32"]. Filters post-fetch. */
  fylker?: string[]
  fraAntallAnsatte?: number
  tilAntallAnsatte?: number
  /** How many companies to import this run. */
  count?: number
  /** Only import companies that have email OR phone registered in Brønnøysund. */
  onlyWithContact?: boolean
  /** Only import companies that have an email registered in Brønnøysund. */
  onlyWithEmail?: boolean
  /** Only import companies that have a phone registered in Brønnøysund. */
  onlyWithPhone?: boolean
}

export type ImportProspectsResult = {
  fetched: number
  skipped: number
  existingCustomers: number
  duplicates: number
  backfilled: number
  imported: number
}

/** Default construction NACE prefixes for auto-import (matched by prefix in Brreg):
 *  43 = specialised construction (maler, rør, elektro, tømrer, tak …),
 *  41.2 = oppføring av bygninger. Override with OUTREACH_IMPORT_NACE="43,41.2". */
export function getDefaultImportNace(): string[] {
  const raw = process.env.OUTREACH_IMPORT_NACE?.trim()
  if (raw) {
    const parsed = raw
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean)
    if (parsed.length > 0) return parsed
  }
  return ["43", "41.2"]
}

/** Refill the prospect pool when fewer than this many fresh, sendable prospects
 *  remain. Keeps the daily engine fed. Override with OUTREACH_POOL_MIN. */
export function getPoolMinThreshold(): number {
  return Number(process.env.OUTREACH_POOL_MIN) || 150
}

/** How many prospects to pull from Brreg per auto-import run. Override with
 *  OUTREACH_IMPORT_BATCH. */
export function getImportBatchSize(): number {
  return Number(process.env.OUTREACH_IMPORT_BATCH) || 300
}

/** Count fresh prospects that the initial-send step can actually email right now:
 *  status ny/kvalifisert, has an email, not an existing customer. This is the
 *  "fuel gauge" the cron uses to decide whether to import more. */
export async function countSendableProspects(admin: AdminClient): Promise<number> {
  const { count } = await admin
    .from("prospects")
    .select("id", { count: "exact", head: true })
    .not("email", "is", null)
    .eq("is_existing_customer", false)
    .in("status", ["ny", "kvalifisert"])
  return count ?? 0
}

/**
 * Fetch entities from Brønnøysund and upsert them as prospects, deduping against
 * existing customers and previously-imported prospects. Pure data work — callers
 * handle auth, activity logging and HTTP responses.
 */
export async function importProspects(
  admin: AdminClient,
  params: ImportProspectsParams
): Promise<ImportProspectsResult> {
  const { naeringskoder, fraAntallAnsatte, tilAntallAnsatte } = params
  const count = params.count ?? 100
  const onlyWithContact = params.onlyWithContact ?? false
  const onlyWithEmail = params.onlyWithEmail ?? false
  const onlyWithPhone = params.onlyWithPhone ?? false
  const fylker = params.fylker?.length ? params.fylker : undefined
  const contactFiltered = onlyWithContact || onlyWithEmail || onlyWithPhone

  // Fetch more pages when filtering by fylke or contact, since both reduce density
  // and we need enough raw results to reach `count` matches.
  const maxPages = fylker
    ? 20
    : contactFiltered
      ? Math.min(20, Math.max(Math.ceil(count / 25), 2))
      : Math.min(20, Math.ceil(count / 100))

  // 1. Fetch entities from Brønnøysund, page by page.
  const mapped = new Map<string, MappedProspect>()
  let fetched = 0
  let skipped = 0
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
      if (!row) {
        skipped += 1
        continue
      }
      if (onlyWithContact && !row.email && !row.phone) {
        skipped += 1
        continue
      }
      if (onlyWithEmail && !row.email) {
        skipped += 1
        continue
      }
      if (onlyWithPhone && !row.phone) {
        skipped += 1
        continue
      }
      if (fylker) {
        const knr = row.kommune_number
        if (!knr || !fylker.some((f) => knr.startsWith(f))) {
          skipped += 1
          continue
        }
      }
      mapped.set(row.org_number, row) // dedupe within batch by org_number
    }
    if (mapped.size >= count) break
    if (page + 1 >= result.totalPages) break
  }

  const orgNumbers = [...mapped.keys()].slice(0, count)
  if (orgNumbers.length === 0) {
    return { fetched, skipped, existingCustomers: 0, imported: 0, duplicates: 0, backfilled: 0 }
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
      throw new Error("Kunne ikke lagre prospekter")
    }
    imported = inserted?.length ?? 0
  }

  // 3b. Backfill Brreg contact info onto prospects that were imported earlier and
  // still lack an email. Only fills when email IS NULL, so it never overwrites
  // manually-edited/enriched contacts or touches CRM status.
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

  return {
    fetched,
    skipped,
    existingCustomers: existingCustomerOrgs.size,
    duplicates,
    backfilled,
    imported,
  }
}
