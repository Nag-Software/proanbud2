import { createAdminClient } from "@/lib/supabase/admin"
import type { FikenConnectionRow } from "@/lib/integrations/fiken/types"
import type { IntegrationJobRow } from "@/lib/integrations/tripletex/types"

const PROVIDER = "fiken"

function jitteredBackoffSeconds(attemptCount: number) {
  const base = Math.min(3600, Math.pow(2, Math.max(0, attemptCount)) * 30)
  const jitter = Math.floor(Math.random() * 10)
  return base + jitter
}

export async function enqueueFikenJob(input: {
  companyId: string
  jobType: string
  payload: Record<string, unknown>
  idempotencyKey: string
}) {
  const supabase = createAdminClient()
  const { error } = await supabase.from("integration_jobs").insert({
    company_id: input.companyId,
    provider: PROVIDER,
    job_type: input.jobType,
    payload: input.payload,
    idempotency_key: input.idempotencyKey,
    status: "pending",
    next_run_at: new Date().toISOString(),
  })

  if (error && error.code !== "23505") {
    throw new Error(`Failed to enqueue Fiken job: ${error.message}`)
  }
}

export async function claimFikenJobs(workerId: string, limit = 5) {
  const supabase = createAdminClient()

  // Normalize legacy NULL next_run_at so pending jobs become claimable.
  const { error: normalizeError } = await supabase
    .from("integration_jobs")
    .update({ next_run_at: new Date().toISOString() })
    .eq("provider", PROVIDER)
    .in("status", ["pending", "retry"])
    .is("next_run_at", null)

  if (normalizeError) {
    throw new Error(`Failed to normalize pending jobs: ${normalizeError.message}`)
  }

  const { data, error } = await supabase.rpc("integration_claim_jobs", {
    p_worker: workerId,
    p_provider: PROVIDER,
    p_limit: limit,
  })

  if (error) {
    throw new Error(`Failed to claim Fiken jobs: ${error.message}`)
  }

  return (data || []) as IntegrationJobRow[]
}

export async function markFikenJobCompleted(jobId: number) {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc("integration_mark_job_completed", { p_job_id: jobId })
  if (error) {
    throw new Error(`Failed to complete job ${jobId}: ${error.message}`)
  }
}

export async function markFikenJobRetry(
  job: IntegrationJobRow,
  errorCode: string,
  errorMessage: string,
  rateLimitResetAt?: string
) {
  const supabase = createAdminClient()
  const nextRunAt = rateLimitResetAt
    ? rateLimitResetAt
    : new Date(Date.now() + jitteredBackoffSeconds(job.attempt_count) * 1000).toISOString()

  const shouldDeadLetter = job.attempt_count + 1 >= job.max_attempts
  if (shouldDeadLetter) {
    const { error } = await supabase.rpc("integration_mark_job_failed", {
      p_job_id: job.id,
      p_error_code: errorCode,
      p_error_message: errorMessage,
      p_dead_letter: true,
    })
    if (error) {
      throw new Error(`Failed to dead-letter job ${job.id}: ${error.message}`)
    }
    return
  }

  const { error } = await supabase.rpc("integration_mark_job_retry", {
    p_job_id: job.id,
    p_error_code: errorCode,
    p_error_message: errorMessage,
    p_next_run_at: nextRunAt,
  })

  if (error) {
    throw new Error(`Failed to retry job ${job.id}: ${error.message}`)
  }
}

export async function markFikenJobFailed(job: IntegrationJobRow, errorCode: string, errorMessage: string) {
  const supabase = createAdminClient()
  const shouldDeadLetter = job.attempt_count + 1 >= job.max_attempts
  const { error } = await supabase.rpc("integration_mark_job_failed", {
    p_job_id: job.id,
    p_error_code: errorCode,
    p_error_message: errorMessage,
    p_dead_letter: shouldDeadLetter,
  })
  if (error) {
    throw new Error(`Failed to mark job failed ${job.id}: ${error.message}`)
  }
}

export async function updateFikenConnectionHealth(input: {
  companyId: string
  success: boolean
  errorMessage?: string | null
}) {
  const supabase = createAdminClient()
  const now = new Date().toISOString()

  if (input.success) {
    await supabase
      .from("fiken_connections")
      .update({ sync_state: "connected", last_success_at: now, last_error_at: null, last_error_message: null })
      .eq("company_id", input.companyId)
    return
  }

  await supabase
    .from("fiken_connections")
    .update({
      sync_state: "degraded",
      last_error_at: now,
      last_error_message: input.errorMessage ? input.errorMessage.slice(0, 1000) : "Sync failed",
    })
    .eq("company_id", input.companyId)
}

// --- external_entity_links (provider='fiken') -------------------------------
export async function upsertFikenLink(input: {
  companyId: string
  entityType: string
  localId: string
  externalId: number
  syncStatus?: string
  externalUrl?: string | null
}) {
  const supabase = createAdminClient()
  const { error } = await supabase.from("external_entity_links").upsert(
    {
      company_id: input.companyId,
      provider: PROVIDER,
      entity_type: input.entityType,
      local_id: input.localId,
      external_id: input.externalId,
      sync_status: input.syncStatus || "synced",
      external_url: input.externalUrl || null,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "company_id,provider,entity_type,local_id" }
  )

  if (error) {
    throw new Error(`Failed to upsert Fiken link: ${error.message}`)
  }
}

export async function getFikenLink(input: { companyId: string; entityType: string; localId: string }) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("external_entity_links")
    .select("external_id, external_url, sync_status")
    .eq("company_id", input.companyId)
    .eq("provider", PROVIDER)
    .eq("entity_type", input.entityType)
    .eq("local_id", input.localId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to get Fiken link: ${error.message}`)
  }
  return data
}

export async function getFikenLocalByExternal(input: {
  companyId: string
  entityType: string
  externalId: number
}) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("external_entity_links")
    .select("local_id, external_url, sync_status")
    .eq("company_id", input.companyId)
    .eq("provider", PROVIDER)
    .eq("entity_type", input.entityType)
    .eq("external_id", input.externalId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to get Fiken local link by external id: ${error.message}`)
  }
  return data
}

export async function getFikenConnection(companyId: string): Promise<FikenConnectionRow | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("fiken_connections")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load Fiken connection: ${error.message}`)
  }
  return (data as FikenConnectionRow) || null
}

// --- Global worker mutex (DB-backed, TTL'd) ---------------------------------
export async function tryAcquireFikenWorkerLock(workerId: string, ttlSeconds = 300) {
  const supabase = createAdminClient()
  const { data, error } = await supabase.rpc("integration_try_acquire_worker_lock", {
    p_provider: PROVIDER,
    p_worker: workerId,
    p_ttl_seconds: ttlSeconds,
  })
  if (error) {
    throw new Error(`Failed to acquire Fiken worker lock: ${error.message}`)
  }
  return data === true
}

export async function releaseFikenWorkerLock(workerId: string) {
  const supabase = createAdminClient()
  await supabase.rpc("integration_release_worker_lock", { p_provider: PROVIDER, p_worker: workerId })
}
