import { createAdminClient } from "@/lib/supabase/admin"
import type { IntegrationJobRow } from "@/lib/integrations/tripletex/types"

function jitteredBackoffSeconds(attemptCount: number) {
  const base = Math.min(3600, Math.pow(2, Math.max(0, attemptCount)) * 15)
  const jitter = Math.floor(Math.random() * 10)
  return base + jitter
}

export async function enqueueIntegrationJob(input: {
  companyId: string
  jobType: string
  payload: Record<string, unknown>
  idempotencyKey: string
  provider?: string
}) {
  const supabase = createAdminClient()
  const { error } = await supabase.from("integration_jobs").insert({
    company_id: input.companyId,
    provider: input.provider || "tripletex",
    job_type: input.jobType,
    payload: input.payload,
    idempotency_key: input.idempotencyKey,
    status: "pending",
    next_run_at: new Date().toISOString(),
  })

  if (error && error.code !== "23505") {
    throw new Error(`Failed to enqueue integration job: ${error.message}`)
  }
}

export async function claimJobs(workerId: string, limit = 20) {
  const supabase = createAdminClient()

  // Legacy rows with NULL next_run_at can never be claimed by the RPC selector.
  // Normalize them so existing pending jobs become runnable.
  const { error: normalizeError } = await supabase
    .from("integration_jobs")
    .update({ next_run_at: new Date().toISOString() })
    .eq("provider", "tripletex")
    .in("status", ["pending", "retry"])
    .is("next_run_at", null)

  if (normalizeError) {
    throw new Error(`Failed to normalize pending jobs: ${normalizeError.message}`)
  }

  const { data, error } = await supabase.rpc("integration_claim_jobs", {
    p_worker: workerId,
    p_provider: "tripletex",
    p_limit: limit,
  })

  if (error) {
    throw new Error(`Failed to claim jobs: ${error.message}`)
  }

  return (data || []) as IntegrationJobRow[]
}

export async function markJobCompleted(jobId: number) {
  const supabase = createAdminClient()
  const { error } = await supabase.rpc("integration_mark_job_completed", { p_job_id: jobId })
  if (error) {
    throw new Error(`Failed to complete job ${jobId}: ${error.message}`)
  }
}

export async function markJobRetry(job: IntegrationJobRow, errorCode: string, errorMessage: string, rateLimitResetAt?: string) {
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

export async function markJobFailed(job: IntegrationJobRow, errorCode: string, errorMessage: string) {
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

export async function getTripletexConnection(companyId: string) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("tripletex_connections")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load Tripletex connection: ${error.message}`)
  }

  return data
}

export async function upsertExternalEntityLink(input: {
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
      provider: "tripletex",
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
    throw new Error(`Failed to upsert external link: ${error.message}`)
  }
}

export async function getExternalEntityLink(input: {
  companyId: string
  entityType: string
  localId: string
}) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("external_entity_links")
    .select("external_id, external_url")
    .eq("company_id", input.companyId)
    .eq("provider", "tripletex")
    .eq("entity_type", input.entityType)
    .eq("local_id", input.localId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to get external link: ${error.message}`)
  }

  return data
}

export async function getLocalEntityLinkByExternal(input: {
  companyId: string
  entityType: string
  externalId: number
}) {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("external_entity_links")
    .select("local_id, external_url")
    .eq("company_id", input.companyId)
    .eq("provider", "tripletex")
    .eq("entity_type", input.entityType)
    .eq("external_id", input.externalId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to get local link by external id: ${error.message}`)
  }

  return data
}
