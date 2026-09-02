import { createAdminClient } from "@/lib/supabase/admin"
import { FIKEN_ENTITY_TYPES, FIKEN_JOB_TYPES } from "@/lib/integrations/fiken/job-map"
import { enqueueFikenJob } from "@/lib/integrations/fiken/jobs"
import {
  enqueueOfferFikenSync,
  enqueueProjectInvoiceFikenSync,
  processFikenQueueInBackground,
} from "@/lib/integrations/fiken/sync"
import { runFikenWorker } from "@/lib/integrations/fiken/worker"
import { normalizeScopes, toStoredScopes } from "@/lib/regnskap/scopes"
import type {
  AccountingAdapter,
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
    .from("fiken_connections")
    .select("sync_state, scope_config, fiken_company_slug, last_success_at, last_error_at, last_error_message")
    .eq("company_id", companyId)
    .maybeSingle()
  return data
}

export const fikenAdapter: AccountingAdapter = {
  id: "fiken",

  async getConnectionState(companyId: string): Promise<AccountingConnectionState | null> {
    const data = await loadConnection(companyId)
    if (!data || data.sync_state === "disconnected") return null

    return {
      provider: "fiken",
      syncState: data.sync_state as AccountingSyncState,
      scopes: normalizeScopes("fiken", data.scope_config),
      externalCompanyRef: data.fiken_company_slug || null,
      ready: Boolean(data.fiken_company_slug),
      lastSuccessAt: data.last_success_at || null,
      lastErrorAt: data.last_error_at || null,
      lastErrorMessage: data.last_error_message || null,
    }
  },

  async updateScopes(companyId: string, scopes: AccountingScopeConfig) {
    const admin = createAdminClient()
    const { error } = await admin
      .from("fiken_connections")
      .update({ scope_config: toStoredScopes("fiken", scopes) })
      .eq("company_id", companyId)
    if (error) throw new Error(`Kunne ikke lagre synkomfang for Fiken: ${error.message}`)
  },

  queueJobType(job: AccountingJobType) {
    return FIKEN_JOB_TYPES[job]
  },

  storedEntityTypes(entity: AccountingEntityType) {
    return FIKEN_ENTITY_TYPES[entity]
  },

  enqueueOfferSync(input: EnqueueOfferInput) {
    return enqueueOfferFikenSync({
      companyId: input.companyId,
      offerId: input.offerId,
      customerId: input.customerId,
      projectId: input.projectId,
      source: input.source,
      phase: input.phase,
      sendToCustomer: input.includeInvoice,
    })
  },

  enqueueProjectInvoiceSync(input: EnqueueProjectInvoiceInput) {
    return enqueueProjectInvoiceFikenSync(input)
  },

  async enqueueEntitySync(input: EnqueueEntityInput) {
    const state = await this.getConnectionState(input.companyId)
    if (!state?.ready) return false

    if (input.jobType === "customer.upsert" && state.scopes.customers === false) return false
    if (input.jobType === "project.upsert" && state.scopes.projects !== true) return false

    const jobType = FIKEN_JOB_TYPES[input.jobType]
    if (!jobType) return false

    await enqueueFikenJob({
      companyId: input.companyId,
      jobType,
      payload: input.payload,
      idempotencyKey: `fiken:${input.idempotencyKey}`,
    })
    return true
  },

  async enqueueDocumentSync(input: EnqueueDocumentInput) {
    const state = await this.getConnectionState(input.companyId)
    if (!state?.ready || state.scopes.documents !== true) return false

    if (state.scopes.projects === true) {
      await enqueueFikenJob({
        companyId: input.companyId,
        jobType: "project.upsert",
        payload: { projectId: input.projectId },
        idempotencyKey: `fiken:document:${input.documentItemId}:project:${input.projectId}`,
      })
    }

    await enqueueFikenJob({
      companyId: input.companyId,
      jobType: "document.upload",
      payload: { documentItemId: input.documentItemId, projectId: input.projectId },
      idempotencyKey: `fiken:document:${input.documentItemId}`,
    })
    return true
  },

  // Fiken har ingen prosjektkalender. Se capabilities.ts for teksten brukeren får.
  async enqueueCalendarSync() {
    return false
  },

  async enqueuePaymentPoll(companyId: string, source = "manual") {
    const state = await this.getConnectionState(companyId)
    if (!state?.ready) return false
    await enqueueFikenJob({
      companyId,
      jobType: "poll_payments",
      payload: { source },
      idempotencyKey: `fiken:poll_payments:${companyId}:${Math.floor(Date.now() / 60_000)}`,
    })
    return true
  },

  async enqueueCustomerPull(companyId: string, source = "manual") {
    const state = await this.getConnectionState(companyId)
    const jobType = FIKEN_JOB_TYPES["customer.pull_all"]
    if (!state?.ready || !jobType) return false
    await enqueueFikenJob({
      companyId,
      jobType,
      payload: { source },
      idempotencyKey: `fiken:customer-pull:${companyId}:${Math.floor(Date.now() / 60_000)}`,
    })
    return true
  },

  async enqueueReconcile(companyId: string, source = "manual") {
    const state = await this.getConnectionState(companyId)
    if (!state?.ready) return false
    await enqueueFikenJob({
      companyId,
      jobType: "reconcile.full",
      payload: { source },
      idempotencyKey: `fiken:reconcile:${companyId}:${Math.floor(Date.now() / 60_000)}`,
    })
    return true
  },

  processQueueInBackground(options?: WorkerOptions) {
    // Fiken tåler kun én samtidig forespørsel — små batcher, aldri parallellisert.
    processFikenQueueInBackground({
      batchSize: options?.batchSize ?? 5,
      maxBatches: options?.maxBatches ?? 8,
    })
  },

  runWorker(options?: WorkerOptions) {
    return runFikenWorker({
      workerId: options?.workerId,
      batchSize: options?.batchSize ?? 5,
      maxBatches: options?.maxBatches ?? 15,
    })
  },
}
