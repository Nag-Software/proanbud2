import { tripletexRequest } from "@/lib/integrations/tripletex/connector"
import { getExternalEntityLink, upsertExternalEntityLink } from "@/lib/integrations/tripletex/jobs"
import { getFreshTripletexConnection } from "@/lib/integrations/tripletex/session"
import type { IntegrationJobRow, TripletexConnectionRow } from "@/lib/integrations/tripletex/types"
import {
  buildTripletexCostVoucher,
  DEFAULT_COST_ACCOUNT,
  proanbudCostMarker,
  SUPPLIER_DEBT_ACCOUNT,
} from "@/lib/regnskap/cost-push"
import { loadManualCostForPush } from "@/lib/regnskap/cost-push-source"
import { createAdminClient } from "@/lib/supabase/admin"
import { osloDateString } from "@/lib/timeforing/oslo-date"

/**
 * Materialkost ført i ProAnbud → ikke-bokført bilag i Tripletex
 * (`material_cost.push`), og opprydding (`material_cost.delete`).
 * Hvorfor kladd: se lib/regnskap/cost-push.ts.
 */

const ENTITY = "material_cost_voucher"
/** Inngående mva, høy sats — Tripletex' standard mva-kode for innkjøp. */
const INPUT_VAT_HIGH = "1"

function readValues(response: unknown): Array<Record<string, unknown>> {
  const record = response as Record<string, unknown> | null
  if (!record || typeof record !== "object") return []
  if (Array.isArray(record.values)) return record.values as Array<Record<string, unknown>>
  const wrapped = record.value as Record<string, unknown> | undefined
  if (wrapped && Array.isArray(wrapped.values)) return wrapped.values as Array<Record<string, unknown>>
  return []
}

function readValueId(response: unknown): number | null {
  const value = (response as { value?: { id?: unknown } } | null)?.value
  const id = Number(value?.id)
  return Number.isFinite(id) ? id : null
}

async function findId(connection: TripletexConnectionRow, path: string, what: string) {
  const values = readValues(await tripletexRequest(connection, { path }))
  const id = Number(values[0]?.id)
  if (!Number.isFinite(id)) throw new Error(`Fant ikke ${what} i Tripletex`)
  return id
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(as|asa|ans|da|enk|sa)\b/g, "")
    .replace(/[^a-z0-9æøå]/g, "")
}

/**
 * Leverandøren til motposten (2400 krever leverandør). Tripletex' /supplier har
 * ikke navnesøk, så vi leser listen og matcher på normalisert navn. Finnes den
 * ikke, opprettes den — regnskapsføreren trenger den uansett for å bokføre.
 */
async function resolveSupplierId(connection: TripletexConnectionRow, name: string | null) {
  const wanted = name?.trim()
  if (!wanted) return null
  const target = normalizeName(wanted)
  for (let from = 0; ; from += 1000) {
    const page = readValues(
      await tripletexRequest(connection, {
        path: `/supplier?isInactive=false&from=${from}&count=1000&fields=id,name`,
      })
    )
    const hit = page.find((row) => typeof row.name === "string" && normalizeName(row.name) === target)
    if (hit && Number.isFinite(Number(hit.id))) return Number(hit.id)
    if (page.length < 1000) break
  }
  const created = await tripletexRequest(connection, {
    method: "POST",
    path: "/supplier",
    body: { name: wanted.slice(0, 255) },
  })
  return readValueId(created)
}

/** Vårt eget bilag fra et tidligere forsøk som døde etter POST-en. */
async function findExistingVoucher(connection: TripletexConnectionRow, costId: string) {
  const external = proanbudCostMarker(costId).replace(/\s+/g, "-")
  const values = readValues(
    await tripletexRequest(connection, {
      path: `/ledger/voucher/>externalVoucherNumber?externalVoucherNumber=${encodeURIComponent(external)}&fields=id`,
    })
  )
  const id = Number(values[0]?.id)
  return Number.isFinite(id) ? id : null
}

export async function processTripletexCostPush(job: IntegrationJobRow) {
  const connection = await getFreshTripletexConnection(job.company_id)
  if (!connection) throw new Error("Tripletex connection missing for company")
  if (connection.scope_config?.costs === false) return

  const costId = String(job.payload.materialCostId || "")
  if (!costId) throw new Error("material_cost.push mangler materialCostId")

  const existing = await getExternalEntityLink({ companyId: job.company_id, entityType: ENTITY, localId: costId })
  // En kladd vi har ryddet bort (posten ble koblet, så løsnet igjen) sendes på nytt.
  if (existing && existing.sync_status !== "deleted") return

  const cost = await loadManualCostForPush(job.company_id, costId)
  if (!cost || cost.replacedBy) return

  let voucherId = await findExistingVoucher(connection, costId)
  if (voucherId === null) {
    const [costAccountId, supplierDebtAccountId, vatTypeId, projectLink, supplierId] = await Promise.all([
      findId(connection, `/ledger/account?number=${DEFAULT_COST_ACCOUNT}&fields=id`, `konto ${DEFAULT_COST_ACCOUNT}`),
      findId(connection, `/ledger/account?number=${SUPPLIER_DEBT_ACCOUNT}&fields=id`, `konto ${SUPPLIER_DEBT_ACCOUNT}`),
      cost.vatRegistered
        ? findId(connection, `/ledger/vatType?number=${INPUT_VAT_HIGH}&fields=id`, "mva-kode for inngående mva")
        : Promise.resolve(null),
      getExternalEntityLink({ companyId: job.company_id, entityType: "project", localId: cost.projectId }),
      resolveSupplierId(connection, cost.supplierName),
    ])
    const projectExternalId = projectLink ? Number(projectLink.external_id) : null

    const response = await tripletexRequest(connection, {
      method: "POST",
      path: "/ledger/voucher?sendToLedger=false",
      body: buildTripletexCostVoucher(cost, {
        costAccountId,
        supplierDebtAccountId,
        vatTypeId,
        projectExternalId: Number.isFinite(projectExternalId) ? projectExternalId : null,
        supplierId,
        vatRegistered: cost.vatRegistered,
        today: osloDateString(new Date()),
      }),
    })
    voucherId = readValueId(response)
  }
  if (voucherId === null) throw new Error("Tripletex svarte uten id på bilaget")

  await upsertExternalEntityLink({
    companyId: job.company_id,
    entityType: ENTITY,
    localId: costId,
    externalId: voucherId,
    syncStatus: "sent",
  })
}

export async function processTripletexCostDelete(job: IntegrationJobRow) {
  const costId = String(job.payload.materialCostId || "")
  if (!costId) return
  const link = await getExternalEntityLink({ companyId: job.company_id, entityType: ENTITY, localId: costId })
  if (!link || link.sync_status === "deleted") return

  const connection = await getFreshTripletexConnection(job.company_id)
  if (!connection) throw new Error("Tripletex connection missing for company")

  try {
    await tripletexRequest(connection, { method: "DELETE", path: `/ledger/voucher/${Number(link.external_id)}` })
  } catch (error) {
    const status = (error as { status?: number }).status
    // 404: allerede slettet. 4xx ellers: bilaget er bokført — da eier regnskapet det,
    // og kostnadshentingen kobler det til posten. Vi rører ikke bokførte bilag.
    if (status === undefined || status >= 500) throw error
  }

  const admin = createAdminClient()
  await admin
    .from("external_entity_links")
    .update({ sync_status: "deleted", last_synced_at: new Date().toISOString() })
    .eq("company_id", job.company_id)
    .eq("provider", "tripletex")
    .eq("entity_type", ENTITY)
    .eq("local_id", costId)
}
