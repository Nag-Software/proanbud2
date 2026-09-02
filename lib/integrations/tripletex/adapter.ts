import { createAdminClient } from "@/lib/supabase/admin"
import { TRIPLETEX_ENTITY_TYPES, TRIPLETEX_JOB_TYPES } from "@/lib/integrations/tripletex/job-map"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"
import {
  enqueueCalendarTripletexSync,
  enqueueDocumentTripletexSync,
  enqueueOfferTripletexSync,
  enqueueProjectInvoiceTripletexSync,
  processTripletexQueueInBackground,
} from "@/lib/integrations/tripletex/sync"
import { runTripletexWorker } from "@/lib/integrations/tripletex/worker"
import { normalizeScopes, toStoredScopes } from "@/lib/regnskap/scopes"
import type {
  AccountingAdapter,
  EnqueueCalendarInput,
  EnqueueDocumentInput,
  EnqueueEntityInput,
  EnqueueOfferInput,
  EnqueueProjectInvoiceInput,
  WorkerOptions,
} from "@/lib/regnskap/provider"
import type {
  AccountingConnectionState,
  AccountingEntityType,
  AccountingJobType,
  AccountingScopeConfig,
  AccountingSyncState,
} from "@/lib/regnskap/types"

async function loadConnection(companyId: string) {
  const admin = createAdminClient()
  const { data } = await admin
    .from("tripletex_connections")
    .select("sync_state, scope_config, last_success_at, last_error_at, last_error_message")
    .eq("company_id", companyId)
    .maybeSingle()
  return data
}

export const tripletexAdapter: AccountingAdapter = {
  id: "tripletex",

  async getConnectionState(companyId: string): Promise<AccountingConnectionState | null> {
    const data = await loadConnection(companyId)
    if (!data || data.sync_state === "disconnected") return null

    return {
      provider: "tripletex",
      syncState: data.sync_state as AccountingSyncState,
      scopes: normalizeScopes("tripletex", data.scope_config),
      // Tripletex scoper på selskapet i Basic-auth-headeren, ikke i stien.
      externalCompanyRef: null,
      ready: true,
      lastSuccessAt: data.last_success_at || null,
      lastErrorAt: data.last_error_at || null,
      lastErrorMessage: data.last_error_message || null,
    }
  },

  async updateScopes(companyId: string, scopes: AccountingScopeConfig) {
    const admin = createAdminClient()
    const { error } = await admin
      .from("tripletex_connections")
      .update({ scope_config: toStoredScopes("tripletex", scopes) })
      .eq("company_id", companyId)
    if (error) throw new Error(`Kunne ikke lagre synkomfang for Tripletex: ${error.message}`)
  },

  queueJobType(job: AccountingJobType) {
    return TRIPLETEX_JOB_TYPES[job]
  },

  storedEntityTypes(entity: AccountingEntityType) {
    return TRIPLETEX_ENTITY_TYPES[entity]
  },

  enqueueOfferSync(input: EnqueueOfferInput) {
    return enqueueOfferTripletexSync({
      companyId: input.companyId,
      offerId: input.offerId,
      customerId: input.customerId,
      projectId: input.projectId,
      source: input.source,
      phase: input.phase,
      includeInvoice: input.includeInvoice,
    })
  },

  enqueueProjectInvoiceSync(input: EnqueueProjectInvoiceInput) {
    return enqueueProjectInvoiceTripletexSync(input)
  },

  async enqueueEntitySync(input: EnqueueEntityInput) {
    const state = await this.getConnectionState(input.companyId)
    if (!state?.ready) return false

    if (input.jobType === "customer.upsert" && state.scopes.customers === false) return false
    if (input.jobType === "project.upsert" && state.scopes.projects === false) return false

    const jobType = TRIPLETEX_JOB_TYPES[input.jobType]
    if (!jobType) return false

    await enqueueIntegrationJob({
      companyId: input.companyId,
      jobType,
      payload: input.payload,
      idempotencyKey: input.idempotencyKey,
    })
    return true
  },

  enqueueDocumentSync(input: EnqueueDocumentInput) {
    return enqueueDocumentTripletexSync(input)
  },

  enqueueCalendarSync(input: EnqueueCalendarInput) {
    return enqueueCalendarTripletexSync(input)
  },

  async enqueuePaymentPoll(companyId: string, source = "manual") {
    const state = await this.getConnectionState(companyId)
    if (!state?.ready) return false
    await enqueueIntegrationJob({
      companyId,
      jobType: "poll_payments",
      payload: { source },
      idempotencyKey: `tripletex:poll_payments:${companyId}:${Math.floor(Date.now() / 60_000)}`,
    })
    return true
  },

  async enqueueCustomerPull(companyId: string, source = "manual") {
    const state = await this.getConnectionState(companyId)
    const jobType = TRIPLETEX_JOB_TYPES["customer.pull_all"]
    if (!state?.ready || !jobType) return false
    await enqueueIntegrationJob({
      companyId,
      jobType,
      payload: { source },
      idempotencyKey: `tripletex:customer-pull:${companyId}:${Math.floor(Date.now() / 60_000)}`,
    })
    return true
  },

  async enqueueReconcile(companyId: string, source = "manual") {
    const state = await this.getConnectionState(companyId)
    if (!state?.ready) return false
    await enqueueIntegrationJob({
      companyId,
      jobType: "reconcile.full",
      payload: { source },
      idempotencyKey: `tripletex:reconcile:${companyId}:${Math.floor(Date.now() / 60_000)}`,
    })
    return true
  },

  processQueueInBackground(options?: WorkerOptions) {
    processTripletexQueueInBackground({
      batchSize: options?.batchSize ?? 20,
      maxBatches: options?.maxBatches ?? 8,
    })
  },

  runWorker(options?: WorkerOptions) {
    return runTripletexWorker({
      workerId: options?.workerId,
      batchSize: options?.batchSize ?? 20,
      maxBatches: options?.maxBatches ?? 15,
    })
  },
}
