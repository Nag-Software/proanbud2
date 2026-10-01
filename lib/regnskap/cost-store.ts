import { FIKEN_JOB_TYPES } from "@/lib/integrations/fiken/job-map"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"
import { TRIPLETEX_JOB_TYPES } from "@/lib/integrations/tripletex/job-map"
import {
  matchManualToBooked,
  type AccountingCostRow,
  type AccountingRevenueRow,
  type MaterialCostLike,
} from "@/lib/regnskap/costs"
import type { AccountingProviderId } from "@/lib/regnskap/types"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/fetch-all"

const CHUNK = 500

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Speiler regnskapets kostnader inn i prosjektets materialkostnader
 * (`project_material_costs`, source = leverandøren): nye og endrede rader skrives,
 * rader som ikke lenger finnes i regnskapet (slettet bilag, flyttet til et annet
 * prosjekt) fjernes. Hvert prosjekt får et «sist hentet»-stempel, også når det ikke
 * er ført noe — det er forskjellen på «ingen kostnader» og «ukjent». Til slutt kobles
 * manuelle poster som nå er bokført, så samme kjøp ikke telles to ganger.
 *
 * `windowStart`: når leverandøren bare ble lest fra en dato (Fiken), rører vi
 * ikke rader eldre enn den — de ble ikke sett, så de er ikke borte.
 */
export async function replaceProjectAccountingCosts(input: {
  companyId: string
  provider: AccountingProviderId
  projectIds: string[]
  rows: AccountingCostRow[]
  windowStart?: string
  /** Hentingen ble ikke fullført: lagre det som ble sett, men ikke slett resten. */
  skipCleanup?: boolean
}) {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  for (const batch of chunks(input.rows)) {
    const { error } = await admin.from("project_material_costs").upsert(
      batch.map((row) => ({
        company_id: input.companyId,
        project_id: row.projectId,
        source: input.provider,
        external_id: row.externalId,
        cost_date: row.costDate,
        account_number: row.accountNumber,
        account_name: row.accountName,
        supplier_name: row.supplierName,
        description: row.description,
        voucher_ref: row.voucherRef,
        amount_nok: row.amountNok,
        synced_at: now,
        updated_at: now,
      })),
      { onConflict: "company_id,source,external_id" }
    )
    if (error) throw new Error(`Kunne ikke lagre kostnader fra regnskapet: ${error.message}`)
  }

  const seen = new Set(input.rows.map((row) => row.externalId))
  const countByProject = new Map<string, number>()
  for (const row of input.rows) countByProject.set(row.projectId, (countByProject.get(row.projectId) ?? 0) + 1)

  for (const projectId of input.projectIds) {
    let stale: string[] = []
    if (!input.skipCleanup) {
      const existing = await fetchAllRows<{ id: string; external_id: string }>((from, to) => {
        let query = admin
          .from("project_material_costs")
          .select("id, external_id")
          .eq("company_id", input.companyId)
          .eq("source", input.provider)
          .eq("project_id", projectId)
        if (input.windowStart) query = query.gte("cost_date", input.windowStart)
        return query.order("id", { ascending: true }).range(from, to)
      }).catch((error: Error) => {
        throw new Error(`Kunne ikke lese lagrede kostnader: ${error.message}`)
      })
      stale = existing.filter((row) => !seen.has(String(row.external_id))).map((row) => String(row.id))
    }
    // Manuelle poster som pekte på en slettet rad får replaced_by = NULL (FK) og teller igjen.
    for (const batch of chunks(stale)) {
      const { error } = await admin.from("project_material_costs").delete().in("id", batch)
      if (error) throw new Error(`Kunne ikke rydde kostnader: ${error.message}`)
    }

    const { error: syncError } = await admin.from("project_accounting_cost_syncs").upsert(
      {
        company_id: input.companyId,
        project_id: projectId,
        provider: input.provider,
        pulled_at: now,
        cost_count: countByProject.get(projectId) ?? 0,
      },
      { onConflict: "project_id,provider" }
    )
    if (syncError) throw new Error(`Kunne ikke lagre hentestatus: ${syncError.message}`)

    await linkBookedManualCosts({ companyId: input.companyId, projectId })
  }
}

/**
 * Kobler manuelle materialposter til bokførte kostnader for samme kjøp (se
 * `matchManualToBooked`). Kjøres etter hver henting og når en manuell post legges til.
 * Feiler stille til loggen hos kalleren — en manglende kobling gir et for høyt tall,
 * ikke tapte data.
 */
export async function linkBookedManualCosts(input: { companyId: string; projectId: string }) {
  const admin = createAdminClient()
  const rows = await fetchAllRows<MaterialCostLike>((from, to) =>
    admin
      .from("project_material_costs")
      .select("id, source, amount_nok, cost_date, voucher_ref, replaced_by, keep_separate")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .order("id", { ascending: true })
      .range(from, to)
  ).catch((error: Error) => {
    throw new Error(`Kunne ikke lese materialkostnader: ${error.message}`)
  })

  const matches = matchManualToBooked(rows)
  const now = new Date().toISOString()
  for (const [manualId, bookedId] of matches) {
    const { error } = await admin
      .from("project_material_costs")
      .update({ replaced_by: bookedId, updated_at: now })
      .eq("id", manualId)
      .eq("company_id", input.companyId)
      .eq("source", "manual")
      .is("replaced_by", null)
    if (error) throw new Error(`Kunne ikke koble materialkost til bokført kostnad: ${error.message}`)
  }

  // Kladden vi sendte for posten er overflødig nå: enten ER den det bokførte kjøpet
  // (da er den borte og slettingen gir 404), eller så bokførte regnskapsføreren
  // leverandørfakturaen i stedet, og kladden ville blitt liggende som søppel.
  if (matches.size > 0) await enqueueDraftCleanup(input.companyId, [...matches.keys()])
  return matches.size
}

const DRAFT_ENTITY: Record<AccountingProviderId, string> = {
  fiken: "material_cost_draft",
  tripletex: "material_cost_voucher",
}
const DELETE_JOB: Record<AccountingProviderId, string | null> = {
  fiken: FIKEN_JOB_TYPES["cost.delete"],
  tripletex: TRIPLETEX_JOB_TYPES["cost.delete"],
}

async function enqueueDraftCleanup(companyId: string, manualIds: string[]) {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("external_entity_links")
    .select("provider, local_id")
    .eq("company_id", companyId)
    .in("entity_type", Object.values(DRAFT_ENTITY))
    .in("local_id", manualIds)
    .neq("sync_status", "deleted")
  if (error) throw new Error(`Kunne ikke lese kladdkoblinger: ${error.message}`)
  for (const link of data ?? []) {
    const provider = link.provider as AccountingProviderId
    const jobType = DELETE_JOB[provider]
    if (!jobType) continue
    await enqueueIntegrationJob({
      companyId,
      provider,
      jobType,
      payload: { materialCostId: String(link.local_id) },
      idempotencyKey: `${provider}:material-cost-delete:${link.local_id}:${Math.floor(Date.now() / 60_000)}`,
    })
  }
}

/**
 * Speiler regnskapets inntekter på prosjektene (konto 3000–3999) inn i
 * `project_accounting_revenues`. Samme regler som kostnadene: nye og endrede rader
 * skrives, rader som ikke lenger finnes fjernes (innenfor `windowStart`, og ikke
 * når hentingen ble avbrutt).
 */
export async function replaceProjectAccountingRevenues(input: {
  companyId: string
  provider: AccountingProviderId
  projectIds: string[]
  rows: AccountingRevenueRow[]
  windowStart?: string
  skipCleanup?: boolean
}) {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  for (const batch of chunks(input.rows)) {
    const { error } = await admin.from("project_accounting_revenues").upsert(
      batch.map((row) => ({
        company_id: input.companyId,
        project_id: row.projectId,
        source: input.provider,
        external_id: row.externalId,
        entry_date: row.entryDate,
        account_number: row.accountNumber,
        account_name: row.accountName,
        customer_name: row.customerName,
        description: row.description,
        voucher_ref: row.voucherRef,
        amount_nok: row.amountNok,
        synced_at: now,
      })),
      { onConflict: "company_id,source,external_id" }
    )
    if (error) throw new Error(`Kunne ikke lagre inntekter fra regnskapet: ${error.message}`)
  }

  if (input.skipCleanup) return
  const seen = new Set(input.rows.map((row) => row.externalId))
  for (const projectId of input.projectIds) {
    const existing = await fetchAllRows<{ id: string; external_id: string }>((from, to) => {
      let query = admin
        .from("project_accounting_revenues")
        .select("id, external_id")
        .eq("company_id", input.companyId)
        .eq("source", input.provider)
        .eq("project_id", projectId)
      if (input.windowStart) query = query.gte("entry_date", input.windowStart)
      return query.order("id", { ascending: true }).range(from, to)
    }).catch((error: Error) => {
      throw new Error(`Kunne ikke lese lagrede inntekter: ${error.message}`)
    })
    const stale = existing.filter((row) => !seen.has(String(row.external_id))).map((row) => String(row.id))
    for (const batch of chunks(stale)) {
      const { error } = await admin.from("project_accounting_revenues").delete().in("id", batch)
      if (error) throw new Error(`Kunne ikke rydde inntekter: ${error.message}`)
    }
  }
}
