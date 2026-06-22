import { createAdminClient } from "@/lib/supabase/admin"
import { enqueueFikenJob } from "@/lib/integrations/fiken/jobs"
import { runFikenWorker } from "@/lib/integrations/fiken/worker"
import { normalizeFikenScopeConfig } from "@/lib/integrations/fiken/scopes"
import type { FikenScopeConfig } from "@/lib/integrations/fiken/types"

export async function getFikenConnectionState(companyId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("fiken_connections")
    .select("sync_state, scope_config")
    .eq("company_id", companyId)
    .maybeSingle()

  if (!data || data.sync_state === "disconnected") {
    return null
  }

  return {
    syncState: data.sync_state as string,
    scopeConfig: normalizeFikenScopeConfig(data.scope_config) as FikenScopeConfig,
  }
}

/**
 * Fiken has no mutable order, so the two-phase Tripletex quote→order flow collapses:
 *   phase "quote" → create a Fiken offer (tilbud)
 *   phase "order" → create an invoice (draft → createInvoice)
 */
export type FikenOfferSyncPhase = "quote" | "order"

export async function enqueueOfferFikenSync(input: {
  companyId: string
  offerId: string
  customerId: string
  projectId?: string | null
  source: string
  phase?: FikenOfferSyncPhase
  sendToCustomer?: boolean
}) {
  const connection = await getFikenConnectionState(input.companyId)
  if (!connection) {
    return false
  }

  const scopes = connection.scopeConfig
  const phase = input.phase || "quote"
  const stableKey = `fiken:offer:${input.offerId}:${phase}`
  const keyPrefix =
    input.source === "manual" ? `${stableKey}:manual:${Math.floor(Date.now() / 30_000)}` : stableKey

  if (scopes.contacts) {
    await enqueueFikenJob({
      companyId: input.companyId,
      jobType: "contact.upsert",
      payload: { customerId: input.customerId },
      idempotencyKey: `${keyPrefix}:contact:${input.customerId}`,
    })
  }

  // Projects only matter once we invoice (order phase) — mirrors Tripletex behaviour.
  if (input.projectId && scopes.projects && phase === "order") {
    await enqueueFikenJob({
      companyId: input.companyId,
      jobType: "project.upsert",
      payload: { projectId: input.projectId },
      idempotencyKey: `${keyPrefix}:project:${input.projectId}`,
    })
  }

  if (scopes.offers) {
    if (phase === "quote") {
      await enqueueFikenJob({
        companyId: input.companyId,
        jobType: "offer.create_from_offer",
        payload: { offerId: input.offerId, customerId: input.customerId, projectId: input.projectId },
        idempotencyKey: `${stableKey}:offer`,
      })
    } else if (scopes.invoices) {
      await enqueueFikenJob({
        companyId: input.companyId,
        jobType: "invoice.create_from_offer",
        payload: {
          offerId: input.offerId,
          customerId: input.customerId,
          projectId: input.projectId,
          sendToCustomer: input.sendToCustomer === true,
        },
        idempotencyKey: `${stableKey}:invoice`,
      })
    }
  }

  return true
}

export function processFikenQueueInBackground(input?: { batchSize?: number; maxBatches?: number }) {
  void runFikenWorker({
    workerId: `fiken-bg-${Date.now()}`,
    batchSize: input?.batchSize ?? 5,
    maxBatches: input?.maxBatches ?? 5,
  }).catch((error) => {
    console.error("Fiken background worker failed:", error)
  })
}

export async function enqueueOfferFikenSyncAndProcess(input: {
  companyId: string
  offerId: string
  customerId: string
  projectId?: string | null
  source: string
  phase?: FikenOfferSyncPhase
  sendToCustomer?: boolean
  waitForCompletion?: boolean
}) {
  const enqueued = await enqueueOfferFikenSync(input)
  if (!enqueued) {
    return false
  }

  if (input.waitForCompletion) {
    await runFikenWorker({ batchSize: 5, maxBatches: 15 })
    return true
  }

  processFikenQueueInBackground({ batchSize: 5, maxBatches: 8 })
  return true
}

export async function enqueueFikenPaymentPoll(companyId: string, source = "manual") {
  const connection = await getFikenConnectionState(companyId)
  if (!connection) {
    return false
  }
  await enqueueFikenJob({
    companyId,
    jobType: "poll_payments",
    payload: { source },
    idempotencyKey: `fiken:poll_payments:${companyId}:${Math.floor(Date.now() / 60_000)}`,
  })
  return true
}

export async function fetchOfferFikenSyncStatus(
  companyId: string,
  offerId: string,
  customerId: string | null,
  projectId: string | null
) {
  const admin = createAdminClient()
  const [connectionResult, linksResult, pendingJobsResult] = await Promise.all([
    admin.from("fiken_connections").select("sync_state").eq("company_id", companyId).maybeSingle(),
    admin
      .from("external_entity_links")
      .select("entity_type, external_id, external_url, sync_status, last_synced_at, local_id")
      .eq("company_id", companyId)
      .eq("provider", "fiken")
      .in("local_id", [offerId, customerId, projectId].filter(Boolean) as string[]),
    admin
      .from("integration_jobs")
      .select("job_type, status, last_error_message, payload")
      .eq("company_id", companyId)
      .eq("provider", "fiken")
      .in("status", ["pending", "processing", "retry"]),
  ])

  const connected = Boolean(connectionResult.data && connectionResult.data.sync_state !== "disconnected")
  const links = linksResult.data || []
  const pendingJobs = (pendingJobsResult.data || []).filter((row) => {
    const payload = (row.payload || {}) as Record<string, unknown>
    return (
      String(payload.offerId || "") === offerId ||
      (customerId && String(payload.customerId || "") === customerId) ||
      (projectId && String(payload.projectId || "") === projectId)
    )
  })

  const byType = (entityType: string) => links.find((row) => row.entity_type === entityType) || null

  return {
    connected,
    customer: customerId ? byType("contact") : null,
    project: projectId ? byType("project") : null,
    offer: byType("offer"),
    invoice: byType("invoice"),
    pendingJobs,
  }
}
