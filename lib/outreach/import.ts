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

const PAGE_SIZE = 100

/** Brønnøysund hard-caps deep paging at size*(page+1) <= 10_000, so with size 100
 *  only pages 0–99 are reachable for any single query+sort. */
const MAX_REACHABLE_PAGE = Math.floor(10000 / PAGE_SIZE) - 1

/** Sort orders we rotate through at random on each import. Brreg's default order is
 *  alphabetical by name, so always starting at page 0 re-scans the same A→Å head and
 *  finds nothing new. Each sort exposes a *different* reachable 10k slice and a
 *  non-alphabetical starting point, so repeated imports keep surfacing fresh firms. */
const BRREG_SORTS = [
  "navn,asc",
  "navn,desc",
  "organisasjonsnummer,asc",
  "organisasjonsnummer,desc",
  "registreringsdatoEnhetsregisteret,desc",
  "registreringsdatoEnhetsregisteret,asc",
] as const

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Fisher–Yates shuffle — returns a new array so callers can walk pages in a random
 *  (asymmetric) order instead of 0,1,2,…  */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
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
 *
 * To guarantee that every import surfaces *new* companies (and not the same
 * alphabetical head over and over), we pick a random sort order and walk pages in
 * a random order, then drop any org we've already imported BEFORE spending the
 * `count` budget on it — so the budget is only ever filled with genuinely new firms.
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

  // Random sort → a different reachable slice + a non-alphabetical start each run.
  const sort = pickRandom(BRREG_SORTS)

  // Ingest one Brreg page's worth of entities into `candidates`, applying the
  // post-fetch filters. Returns how many rows were skipped by the filters.
  const candidates = new Map<string, MappedProspect>()
  let fetched = 0
  let skipped = 0
  const ingest = (enheter: Awaited<ReturnType<typeof searchBrregEnheter>>["enheter"]) => {
    fetched += enheter.length
    for (const enhet of enheter) {
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
      candidates.set(row.org_number, row) // dedupe within batch by org_number
    }
  }

  // 1. Probe page 0 to learn the result-set size for this query+sort.
  const probe = await searchBrregEnheter({
    naeringskoder,
    fraAntallAnsatte,
    tilAntallAnsatte,
    sort,
    page: 0,
    size: PAGE_SIZE,
  })
  ingest(probe.enheter)

  // Pages we're allowed to read (Brreg caps deep paging; never exceed totalPages).
  const reachablePageCount = Math.min(probe.totalPages || 1, MAX_REACHABLE_PAGE + 1)

  // Over-fetch raw candidates so enough survive the "already imported" dedup below.
  // Filters cut density hard (a single fylke is ~1/12 of results, email ~1/2), so we
  // scale how many pages we're willing to pull accordingly, capped to stay within
  // the route's 60s budget.
  const densityDivisor = fylker ? 12 : onlyWithEmail || onlyWithPhone ? 6 : contactFiltered ? 2 : 1
  const wantCandidates = count * 2 + 50
  const estPages = Math.ceil((wantCandidates * densityDivisor) / PAGE_SIZE)
  const maxPagesThisRun = Math.min(reachablePageCount, Math.max(estPages, 4), 60)

  // 2. Walk the remaining reachable pages in random order until we've gathered
  // enough candidates or hit the page budget.
  const pageQueue = shuffle(
    Array.from({ length: reachablePageCount }, (_, i) => i).filter((p) => p !== 0)
  )
  let pagesUsed = 1 // probe counted as page 0
  for (const page of pageQueue) {
    if (candidates.size >= wantCandidates) break
    if (pagesUsed >= maxPagesThisRun) break
    const result = await searchBrregEnheter({
      naeringskoder,
      fraAntallAnsatte,
      tilAntallAnsatte,
      sort,
      page,
      size: PAGE_SIZE,
    })
    ingest(result.enheter)
    pagesUsed += 1
  }

  const candidateOrgs = [...candidates.keys()]
  if (candidateOrgs.length === 0) {
    return { fetched, skipped, existingCustomers: 0, imported: 0, duplicates: 0, backfilled: 0 }
  }

  // 3. Find which candidates are already prospects or registered customers, so we
  // never re-import and the `count` budget goes entirely to new firms.
  const existingProspectOrgs = new Set<string>()
  const existingCustomerOrgs = new Set<string>()
  for (const orgChunk of chunk(candidateOrgs, 300)) {
    const [prospectRes, companyRes] = await Promise.all([
      admin.from("prospects").select("org_number").in("org_number", orgChunk),
      admin.from("companies").select("org_number").in("org_number", orgChunk),
    ])
    for (const r of prospectRes.data ?? []) if (r.org_number) existingProspectOrgs.add(r.org_number)
    for (const r of companyRes.data ?? []) if (r.org_number) existingCustomerOrgs.add(r.org_number)
  }

  const newOrgs = candidateOrgs.filter(
    (org) => !existingProspectOrgs.has(org) && !existingCustomerOrgs.has(org)
  )
  const toInsert = newOrgs.slice(0, count).map((org) => candidates.get(org)!)

  // 4. Insert the new prospects. onConflict still guards against a concurrent run
  // having inserted the same org between our dedup read and this write.
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

  // 5. Backfill Brreg contact info onto prospects that were imported earlier and
  // still lack an email. Only fills when email IS NULL, so it never overwrites
  // manually-edited/enriched contacts or touches CRM status. Capped to stay within
  // the time budget.
  let backfilled = 0
  const backfillTargets = candidateOrgs
    .filter((org) => existingProspectOrgs.has(org))
    .map((org) => candidates.get(org)!)
    .filter((p) => p.email || p.phone)
    .slice(0, 100)
  for (const p of backfillTargets) {
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

  return {
    fetched,
    skipped,
    existingCustomers: existingCustomerOrgs.size,
    duplicates: existingProspectOrgs.size,
    backfilled,
    imported,
  }
}
