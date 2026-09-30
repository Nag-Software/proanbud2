import type { AccountingCostRow } from "@/lib/regnskap/costs"
import type { AccountingProviderId } from "@/lib/regnskap/types"
import { createAdminClient } from "@/lib/supabase/admin"

const CHUNK = 500

function chunks<T>(items: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/**
 * Speiler regnskapets kostnader for et sett prosjekter: nye og endrede rader
 * skrives, rader som ikke lenger finnes i regnskapet (slettet bilag, flyttet til
 * et annet prosjekt) fjernes. Hvert prosjekt får et «sist hentet»-stempel, også
 * når det ikke er ført noe — det er forskjellen på «ingen kostnader» og «ukjent».
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
}) {
  const admin = createAdminClient()
  const now = new Date().toISOString()

  for (const batch of chunks(input.rows)) {
    const { error } = await admin.from("project_accounting_costs").upsert(
      batch.map((row) => ({
        company_id: input.companyId,
        project_id: row.projectId,
        provider: input.provider,
        external_id: row.externalId,
        cost_date: row.costDate,
        account_number: row.accountNumber,
        account_name: row.accountName,
        supplier_name: row.supplierName,
        description: row.description,
        voucher_ref: row.voucherRef,
        amount_nok: row.amountNok,
        synced_at: now,
      })),
      { onConflict: "company_id,provider,external_id" }
    )
    if (error) throw new Error(`Kunne ikke lagre kostnader fra regnskapet: ${error.message}`)
  }

  const seen = new Set(input.rows.map((row) => row.externalId))
  const countByProject = new Map<string, number>()
  for (const row of input.rows) countByProject.set(row.projectId, (countByProject.get(row.projectId) ?? 0) + 1)

  for (const projectId of input.projectIds) {
    let existingQuery = admin
      .from("project_accounting_costs")
      .select("id, external_id")
      .eq("company_id", input.companyId)
      .eq("provider", input.provider)
      .eq("project_id", projectId)
    if (input.windowStart) existingQuery = existingQuery.gte("cost_date", input.windowStart)
    const { data: existing, error: existingError } = await existingQuery
    if (existingError) throw new Error(`Kunne ikke lese lagrede kostnader: ${existingError.message}`)

    const stale = (existing ?? []).filter((row) => !seen.has(String(row.external_id))).map((row) => String(row.id))
    for (const batch of chunks(stale)) {
      const { error } = await admin.from("project_accounting_costs").delete().in("id", batch)
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
  }
}
