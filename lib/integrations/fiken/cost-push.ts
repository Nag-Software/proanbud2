import {
  createFikenPurchaseDraft,
  deleteFikenPurchaseDraft,
  listFikenPurchaseDrafts,
} from "@/lib/integrations/fiken/connector"
import { getFikenLink, upsertFikenLink } from "@/lib/integrations/fiken/jobs"
import { getFreshFikenConnection } from "@/lib/integrations/fiken/session"
import type { FikenConnectionRow } from "@/lib/integrations/fiken/types"
import type { IntegrationJobRow } from "@/lib/integrations/tripletex/types"
import { buildFikenPurchaseDraft, proanbudCostMarker } from "@/lib/regnskap/cost-push"
import { loadManualCostForPush } from "@/lib/regnskap/cost-push-source"
import { createAdminClient } from "@/lib/supabase/admin"
import { osloDateString } from "@/lib/timeforing/oslo-date"

/**
 * Materialkost ført i ProAnbud → kjøpskladd i Fiken (`material_cost.push`), og
 * opprydding når posten slettes eller er bokført (`material_cost.delete`).
 * Hvorfor kladd: se lib/regnskap/cost-push.ts.
 */

const ENTITY = "material_cost_draft"
/** Kladder er få; flere sider enn dette leter vi ikke gjennom. */
const MAX_DRAFT_PAGES = 5

/**
 * Fiken har ingen idempotency-nøkkel. Døde forrige forsøk etter at POST-en rakk
 * fram, ligger kladden der allerede — finn den på merket i linjeteksten.
 */
async function findExistingDraft(connection: FikenConnectionRow, costId: string): Promise<number | null> {
  const marker = proanbudCostMarker(costId)
  for (let page = 0; page < MAX_DRAFT_PAGES; page += 1) {
    const { items, pageCount } = await listFikenPurchaseDrafts(connection, { page })
    for (const draft of items) {
      const lines = Array.isArray(draft.lines) ? (draft.lines as Array<{ text?: unknown }>) : []
      if (lines.some((line) => typeof line.text === "string" && line.text.includes(marker))) {
        const id = Number(draft.draftId)
        if (Number.isFinite(id)) return id
      }
    }
    if (page + 1 >= pageCount || items.length === 0) break
  }
  return null
}

export async function processFikenCostPush(job: IntegrationJobRow) {
  const connection = await getFreshFikenConnection(job.company_id)
  if (!connection) throw new Error("Fiken connection missing for company")
  if (connection.scope_config?.costs === false) return

  const costId = String(job.payload.materialCostId || "")
  if (!costId) throw new Error("material_cost.push mangler materialCostId")

  const existing = await getFikenLink({ companyId: job.company_id, entityType: ENTITY, localId: costId })
  // En kladd vi har ryddet bort (posten ble koblet, så løsnet igjen) sendes på nytt.
  if (existing && existing.sync_status !== "deleted") return

  const cost = await loadManualCostForPush(job.company_id, costId)
  // Slettet, eller allerede funnet igjen som bokført: ingenting å sende.
  if (!cost || cost.replacedBy) return

  const found = await findExistingDraft(connection, costId)
  let draftId = found
  if (draftId === null) {
    const projectLink = await getFikenLink({
      companyId: job.company_id,
      entityType: "project",
      localId: cost.projectId,
    })
    const fikenProjectId = projectLink ? Number(projectLink.external_id) : null

    const response = await createFikenPurchaseDraft(
      connection,
      buildFikenPurchaseDraft(cost, {
        fikenProjectId: Number.isFinite(fikenProjectId) ? fikenProjectId : null,
        vatRegistered: cost.vatRegistered,
        today: osloDateString(new Date()),
      })
    )
    draftId = response.locationId
  }
  if (draftId === null) throw new Error("Fiken svarte uten id på kjøpskladden")

  await upsertFikenLink({
    companyId: job.company_id,
    entityType: ENTITY,
    localId: costId,
    externalId: draftId,
    syncStatus: "sent",
  })
}

export async function processFikenCostDelete(job: IntegrationJobRow) {
  const costId = String(job.payload.materialCostId || "")
  if (!costId) return
  const link = await getFikenLink({ companyId: job.company_id, entityType: ENTITY, localId: costId })
  if (!link || link.sync_status === "deleted") return

  const connection = await getFreshFikenConnection(job.company_id)
  if (!connection) throw new Error("Fiken connection missing for company")

  try {
    await deleteFikenPurchaseDraft(connection, Number(link.external_id))
  } catch (error) {
    // 404: kladden er allerede bokført (blitt et kjøp) eller slettet i Fiken. Begge er greit.
    if ((error as { status?: number }).status !== 404) throw error
  }

  const admin = createAdminClient()
  await admin
    .from("external_entity_links")
    .update({ sync_status: "deleted", last_synced_at: new Date().toISOString() })
    .eq("company_id", job.company_id)
    .eq("provider", "fiken")
    .eq("entity_type", ENTITY)
    .eq("local_id", costId)
}
