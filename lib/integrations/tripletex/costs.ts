import { tripletexRequest } from "@/lib/integrations/tripletex/connector"
import { getFreshTripletexConnection } from "@/lib/integrations/tripletex/session"
import type { IntegrationJobRow } from "@/lib/integrations/tripletex/types"
import { mapTripletexPostingsToCosts } from "@/lib/regnskap/costs"
import { replaceProjectAccountingCosts } from "@/lib/regnskap/cost-store"
import { createAdminClient } from "@/lib/supabase/admin"
import { fetchAllRows } from "@/lib/supabase/fetch-all"
import { osloDateString } from "@/lib/timeforing/oslo-date"

/**
 * Kostnader ført på prosjekt i Tripletex → ProAnbud (`costs.pull`).
 *
 * Leser hovedbokposteringene på hvert koblede prosjekt. Hva som telles (og hva
 * som bevisst holdes utenfor — lønn og kjørebokas egne reiseregninger) står i
 * lib/regnskap/costs.ts. Jobben bare leser fra Tripletex; den skriver ingenting der.
 */

const PAGE_SIZE = 1000

function readValues(response: unknown): Array<Record<string, unknown>> {
  const record = response as Record<string, unknown> | null
  if (!record || typeof record !== "object") return []
  if (Array.isArray(record.values)) return record.values as Array<Record<string, unknown>>
  const wrapped = record.value as Record<string, unknown> | undefined
  if (wrapped && Array.isArray(wrapped.values)) return wrapped.values as Array<Record<string, unknown>>
  return []
}

export async function processCostsPull(job: IntegrationJobRow) {
  const connection = await getFreshTripletexConnection(job.company_id)
  if (!connection) throw new Error("Tripletex connection missing for company")
  if (connection.scope_config?.costs === false) return

  const admin = createAdminClient()
  const onlyProjectId = typeof job.payload.projectId === "string" ? job.payload.projectId : null

  // Paginert: kjørebokkoblingene vokser med hver tur, og forbi 1000 ville reiseregninger
  // ellers telt dobbelt (som kjøring OG som «andre kostnader»).
  const [projectLinks, tripLinks] = await Promise.all([
    fetchAllRows<{ local_id: string; external_id: string | number }>((from, to) => {
      let query = admin
        .from("external_entity_links")
        .select("local_id, external_id")
        .eq("company_id", job.company_id)
        .eq("provider", "tripletex")
        .eq("entity_type", "project")
      if (onlyProjectId) query = query.eq("local_id", onlyProjectId)
      return query.order("id", { ascending: true }).range(from, to)
    }).catch((error: Error) => {
      throw new Error(`Kunne ikke hente prosjektkoblinger: ${error.message}`)
    }),
    fetchAllRows<{ external_id: string | number }>((from, to) =>
      admin
        .from("external_entity_links")
        .select("external_id")
        .eq("company_id", job.company_id)
        .eq("provider", "tripletex")
        .eq("entity_type", "kjorebok_trip")
        .order("id", { ascending: true })
        .range(from, to)
    ).catch((error: Error) => {
      throw new Error(`Kunne ikke hente kjørebokkoblinger: ${error.message}`)
    }),
  ])

  const ownTravelExpenseIds = new Set(tripLinks.map((row) => Number(row.external_id)))
  // «dateTo» er ekskluderende i Tripletex; i morgen tar med alt til og med i dag.
  const dateTo = osloDateString(new Date(Date.now() + 86_400_000))

  for (const link of projectLinks) {
    const projectId = String(link.local_id)
    const projectExternalId = Number(link.external_id)

    // Reiseregninger fra kjøreboka ligger allerede i lønnsomheten som kjøring.
    // Bilagene deres skal ikke telles en gang til som «andre kostnader».
    const excludedVoucherIds = new Set<number>()
    if (ownTravelExpenseIds.size > 0) {
      const response = await tripletexRequest(connection, {
        path: `/travelExpense?projectId=${projectExternalId}&count=1000&fields=id,voucher(id)`,
      })
      for (const expense of readValues(response)) {
        const voucher = expense.voucher as { id?: unknown } | null | undefined
        if (ownTravelExpenseIds.has(Number(expense.id)) && Number.isFinite(Number(voucher?.id))) {
          excludedVoucherIds.add(Number(voucher?.id))
        }
      }
    }

    const postings: Array<Record<string, unknown>> = []
    for (let from = 0; ; from += PAGE_SIZE) {
      const response = await tripletexRequest(connection, {
        path:
          `/ledger/posting?projectId=${projectExternalId}&dateFrom=2000-01-01&dateTo=${dateTo}` +
          `&accountNumberFrom=4000&accountNumberTo=7999&from=${from}&count=${PAGE_SIZE}` +
          `&fields=id,date,description,amount,account(number,name),supplier(name),voucher(id,number,year)`,
      })
      const page = readValues(response)
      postings.push(...page)
      if (page.length < PAGE_SIZE) break
    }

    const rows = mapTripletexPostingsToCosts(postings, { projectId, excludedVoucherIds })
    await replaceProjectAccountingCosts({
      companyId: job.company_id,
      provider: "tripletex",
      projectIds: [projectId],
      rows,
    })
  }
}
