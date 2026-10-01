import "server-only"

import type { ManualCostForPush } from "@/lib/regnskap/cost-push"
import { createAdminClient } from "@/lib/supabase/admin"

export type ManualCostPushSource = ManualCostForPush & {
  projectId: string
  /** Satt når posten allerede er funnet igjen som bokført — da sendes ingenting. */
  replacedBy: string | null
  vatRegistered: boolean
}

/**
 * Leser en MANUELL materialkost slik kladd-jobbene trenger den. `null` når posten
 * er slettet eller ikke er manuell (bokførte rader kommer fra regnskapet og skal
 * aldri sendes tilbake dit).
 */
export async function loadManualCostForPush(
  companyId: string,
  costId: string
): Promise<ManualCostPushSource | null> {
  const admin = createAdminClient()
  const { data: row, error } = await admin
    .from("project_material_costs")
    .select("id, project_id, source, supplier_name, description, amount_nok, invoice_ref, cost_date, replaced_by")
    .eq("company_id", companyId)
    .eq("id", costId)
    .maybeSingle()
  if (error) throw new Error(`Kunne ikke lese materialkost: ${error.message}`)
  if (!row || row.source !== "manual") return null

  const [{ data: project }, { data: company }] = await Promise.all([
    admin.from("projects").select("name").eq("id", row.project_id).maybeSingle(),
    admin.from("companies").select("vat_registered").eq("id", companyId).maybeSingle(),
  ])

  return {
    id: String(row.id),
    projectId: String(row.project_id),
    supplierName: row.supplier_name ?? null,
    description: row.description ?? null,
    amountNok: Number(row.amount_nok),
    invoiceRef: row.invoice_ref ?? null,
    costDate: row.cost_date ?? null,
    projectName: project?.name ?? null,
    replacedBy: row.replaced_by ?? null,
    vatRegistered: company?.vat_registered !== false,
  }
}
