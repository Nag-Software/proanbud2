import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"
import { runTripletexWorker } from "@/lib/integrations/tripletex/worker"
import type { TripletexScopeConfig } from "@/lib/integrations/tripletex/scopes"

export { parseProjectIdFromDocumentPath } from "@/lib/integrations/tripletex/scopes"

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

export type TripletexOfferSyncPhase = "quote" | "order"

export async function enqueueOfferTripletexSync(input: {
  companyId: string
  offerId: string
  customerId: string
  projectId?: string | null
  source: string
  /** quote = Tilbudsoversikt (project offer). order = Ordrer (after contract). */
  phase?: TripletexOfferSyncPhase
  includeInvoice?: boolean
}) {
  const connection = await getTripletexConnectionState(input.companyId)
  if (!connection) {
    return false
  }

  const scopes = connection.scopeConfig
  const phase = input.phase || "quote"
  const stableOfferKey = `tripletex:offer:${input.offerId}:${phase}`
  const keyPrefix =
    input.source === "manual"
      ? `${stableOfferKey}:manual:${Math.floor(Date.now() / 30_000)}`
      : stableOfferKey

  if (scopes.customers !== false) {
    await enqueueIntegrationJob({
      companyId: input.companyId,
      jobType: "customer.upsert",
      payload: { customerId: input.customerId },
      idempotencyKey: `${keyPrefix}:customer:${input.customerId}`,
    })
  }

  // Utførelsesprosjekt (isOffer=false) synkes kun ved ordre-fase — ikke ved tilbud i Tilbudsoversikt.
  if (input.projectId && scopes.projects !== false && phase === "order") {
    await enqueueIntegrationJob({
      companyId: input.companyId,
      jobType: "project.upsert",
      payload: { projectId: input.projectId },
      idempotencyKey: `${keyPrefix}:project:${input.projectId}`,
    })
  }

  if (scopes.offers !== false) {
    if (phase === "quote") {
      await enqueueIntegrationJob({
        companyId: input.companyId,
        jobType: "offer.upsert",
        payload: {
          offerId: input.offerId,
          customerId: input.customerId,
          projectId: input.projectId,
        },
        idempotencyKey: `${stableOfferKey}:upsert`,
      })
    } else {
      await enqueueIntegrationJob({
        companyId: input.companyId,
        jobType: "order.create_from_offer",
        payload: {
          offerId: input.offerId,
          customerId: input.customerId,
          projectId: input.projectId,
        },
        idempotencyKey: `${stableOfferKey}:order`,
      })

      if (input.includeInvoice && scopes.invoices !== false) {
        await enqueueIntegrationJob({
          companyId: input.companyId,
          jobType: "invoice.create_from_offer",
          payload: { offerId: input.offerId },
          idempotencyKey: `${stableOfferKey}:invoice`,
        })
      }
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

export async function enqueueDocumentTripletexSync(input: {
  companyId: string
  documentItemId: string
  projectId: string
}) {
  const connection = await getTripletexConnectionState(input.companyId)
  if (!connection || connection.scopeConfig.documents !== true) {
    return false
  }

  if (connection.scopeConfig.projects !== false) {
    await enqueueIntegrationJob({
      companyId: input.companyId,
      jobType: "project.upsert",
      payload: { projectId: input.projectId },
      idempotencyKey: `document:${input.documentItemId}:project:${input.projectId}`,
    })
  }

  await enqueueIntegrationJob({
    companyId: input.companyId,
    jobType: "document.upload",
    payload: {
      documentItemId: input.documentItemId,
      projectId: input.projectId,
    },
    idempotencyKey: `document:${input.documentItemId}`,
  })

  processTripletexQueueInBackground({ batchSize: 10, maxBatches: 3 })
  return true
}

export async function enqueueCalendarTripletexSync(input: {
  companyId: string
  eventId: string
  projectId: string
  title: string
  description?: string | null
  start: string
  end: string
}) {
  const connection = await getTripletexConnectionState(input.companyId)
  if (!connection || connection.scopeConfig.calendar !== true) {
    return false
  }

  if (connection.scopeConfig.projects !== false) {
    await enqueueIntegrationJob({
      companyId: input.companyId,
      jobType: "project.upsert",
      payload: { projectId: input.projectId },
      idempotencyKey: `calendar:${input.eventId}:project:${input.projectId}`,
    })
  }

  await enqueueIntegrationJob({
    companyId: input.companyId,
    jobType: "calendar.activity.upsert",
    payload: {
      eventId: input.eventId,
      projectId: input.projectId,
      title: input.title,
      description: input.description || null,
      start: input.start,
      end: input.end,
    },
    idempotencyKey: `calendar:${input.eventId}`,
  })

  processTripletexQueueInBackground({ batchSize: 10, maxBatches: 3 })
  return true
}

export async function enqueueTripletexTravelExpenseSync(input: {
  companyId: string
  tripId: string
}) {
  const connection = await getTripletexConnectionState(input.companyId)
  if (!connection || connection.scopeConfig.travelExpenses !== true) {
    return false
  }
  await enqueueIntegrationJob({
    companyId: input.companyId,
    jobType: "travel_expense.upsert",
    payload: { tripId: input.tripId },
    // Time-bucketed manual suffix so a legitimate re-sync after an edit isn't
    // suppressed by the unique index, while rapid double-clicks collapse to one.
    idempotencyKey: `tripletex:travel_expense:${input.tripId}:${Math.floor(Date.now() / 30_000)}`,
  })
  processTripletexQueueInBackground({ batchSize: 10, maxBatches: 3 })
  return true
}

export async function enqueueTripletexTravelExpenseDelete(input: {
  companyId: string
  tripId: string
  externalId: number
}) {
  const connection = await getTripletexConnectionState(input.companyId)
  if (!connection) {
    return false
  }
  await enqueueIntegrationJob({
    companyId: input.companyId,
    jobType: "travel_expense.delete",
    payload: { tripId: input.tripId, externalId: input.externalId },
    idempotencyKey: `tripletex:travel_expense:${input.tripId}:delete:${Math.floor(Date.now() / 30_000)}`,
  })
  processTripletexQueueInBackground({ batchSize: 10, maxBatches: 3 })
  return true
}

export async function enqueueTripletexEmployeeSync(input: { companyId: string }) {
  const connection = await getTripletexConnectionState(input.companyId)
  if (!connection) {
    return false
  }
  await enqueueIntegrationJob({
    companyId: input.companyId,
    jobType: "employee.sync_all",
    payload: { source: "manual" },
    idempotencyKey: `tripletex:employee_sync:${input.companyId}:${Math.floor(Date.now() / 60_000)}`,
  })
  processTripletexQueueInBackground({ batchSize: 5, maxBatches: 2 })
  return true
}

export function processTripletexQueueInBackground(input?: { batchSize?: number; maxBatches?: number }) {
  void runTripletexWorker({
    workerId: `bg-${Date.now()}`,
    batchSize: input?.batchSize ?? 20,
    maxBatches: input?.maxBatches ?? 5,
  }).catch((error) => {
    console.error("Tripletex background worker failed:", error)
    void logServerError({
      message: "Tripletex background worker failed",
      error,
      level: "warning",
      source: "worker",
      route: "processTripletexQueueInBackground",
    })
  })
}

export async function enqueueOfferTripletexSyncAndProcess(input: {
  companyId: string
  offerId: string
  customerId: string
  projectId?: string | null
  source: string
  phase?: TripletexOfferSyncPhase
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
    offer: byType("offer"),
    order: byType("order"),
    invoice: byType("invoice"),
    pendingJobs,
  }
}
