import { createAdminClient } from "@/lib/supabase/admin"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"
import { runTripletexWorker } from "@/lib/integrations/tripletex/worker"

type TripletexScopeConfig = {
  customers?: boolean
  projects?: boolean
  offers?: boolean
  invoices?: boolean
}

export async function getTripletexConnectionState(companyId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("tripletex_connections")
    .select("sync_state, scope_config")
    .eq("company_id", companyId)
    .maybeSingle()

  if (!data || data.sync_state === "disconnected") {
    return null
  }

  return {
    syncState: data.sync_state as string,
    scopeConfig: (data.scope_config || {}) as TripletexScopeConfig,
  }
}

export async function enqueueOfferTripletexSync(input: {
  companyId: string
  offerId: string
  customerId: string
  projectId: string
  source: string
  includeInvoice?: boolean
}) {
  const connection = await getTripletexConnectionState(input.companyId)
  if (!connection) {
    return false
  }

  const scopes = connection.scopeConfig
  const keyPrefix = `${input.source}:offer:${input.offerId}`

  if (scopes.customers !== false) {
    await enqueueIntegrationJob({
      companyId: input.companyId,
      jobType: "customer.upsert",
      payload: { customerId: input.customerId },
      idempotencyKey: `${keyPrefix}:customer:${input.customerId}`,
    })
  }

  if (scopes.projects !== false) {
    await enqueueIntegrationJob({
      companyId: input.companyId,
      jobType: "project.upsert",
      payload: { projectId: input.projectId },
      idempotencyKey: `${keyPrefix}:project:${input.projectId}`,
    })
  }

  if (scopes.offers !== false) {
    await enqueueIntegrationJob({
      companyId: input.companyId,
      jobType: "order.create_from_offer",
      payload: {
        offerId: input.offerId,
        customerId: input.customerId,
        projectId: input.projectId,
      },
      idempotencyKey: `${keyPrefix}:order`,
    })

    if (input.includeInvoice && scopes.invoices !== false) {
      await enqueueIntegrationJob({
        companyId: input.companyId,
        jobType: "invoice.create_from_offer",
        payload: { offerId: input.offerId },
        idempotencyKey: `${keyPrefix}:invoice`,
      })
    }
  }

  return true
}

export async function enqueueEntityTripletexSync(input: {
  companyId: string
  jobType: "customer.upsert" | "project.upsert"
  payload: Record<string, unknown>
  idempotencyKey: string
}) {
  const connection = await getTripletexConnectionState(input.companyId)
  if (!connection) {
    return false
  }

  const scopes = connection.scopeConfig
  if (input.jobType === "customer.upsert" && scopes.customers === false) {
    return false
  }
  if (input.jobType === "project.upsert" && scopes.projects === false) {
    return false
  }

  await enqueueIntegrationJob({
    companyId: input.companyId,
    jobType: input.jobType,
    payload: input.payload,
    idempotencyKey: input.idempotencyKey,
  })

  return true
}

export function processTripletexQueueInBackground(input?: { batchSize?: number; maxBatches?: number }) {
  void runTripletexWorker({
    workerId: `bg-${Date.now()}`,
    batchSize: input?.batchSize ?? 20,
    maxBatches: input?.maxBatches ?? 5,
  }).catch((error) => {
    console.error("Tripletex background worker failed:", error)
  })
}

export async function enqueueOfferTripletexSyncAndProcess(input: {
  companyId: string
  offerId: string
  customerId: string
  projectId: string
  source: string
  includeInvoice?: boolean
  waitForCompletion?: boolean
}) {
  const enqueued = await enqueueOfferTripletexSync(input)
  if (!enqueued) {
    return false
  }

  if (input.waitForCompletion) {
    await runTripletexWorker({ batchSize: 20, maxBatches: 15 })
    return true
  }

  processTripletexQueueInBackground({ batchSize: 20, maxBatches: 8 })
  return true
}

export async function fetchOfferTripletexSyncStatus(companyId: string, offerId: string, customerId: string | null, projectId: string | null) {
  const admin = createAdminClient()
  const [connectionResult, linksResult, pendingJobsResult] = await Promise.all([
    admin.from("tripletex_connections").select("sync_state").eq("company_id", companyId).maybeSingle(),
    admin
      .from("external_entity_links")
      .select("entity_type, external_id, external_url, sync_status, last_synced_at, local_id")
      .eq("company_id", companyId)
      .eq("provider", "tripletex")
      .in("local_id", [offerId, customerId, projectId].filter(Boolean) as string[]),
    admin
      .from("integration_jobs")
      .select("job_type, status, last_error_message, payload")
      .eq("company_id", companyId)
      .eq("provider", "tripletex")
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
    customer: customerId ? byType("customer") : null,
    project: projectId ? byType("project") : null,
    order: byType("order"),
    invoice: byType("invoice"),
    pendingJobs,
  }
}
