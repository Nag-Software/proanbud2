import { NextResponse } from "next/server"

import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  encryptConnectionTokens,
  refreshTripletexSession,
  refreshTripletexSessionFromApiKey,
} from "@/lib/integrations/tripletex/connector"
import {
  detectTripletexEnvironmentMismatch,
  getTripletexApiBaseUrl,
  hasTripletexConsumerToken,
  normalizeTripletexApiKey,
  resolveTripletexConsumerToken,
  TRIPLETEX_APPLICATION_NAME,
} from "@/lib/integrations/tripletex/config"
import { decryptSecret } from "@/lib/integrations/tripletex/crypto"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"
import {
  buildTripletexScopeConfig,
  hasTripletexScopeOverride,
} from "@/lib/integrations/tripletex/scopes"
import { processTripletexQueueInBackground } from "@/lib/integrations/tripletex/sync"

type KnownErrorShape = Error & {
  status?: number
  body?: Record<string, unknown>
}

function formatTripletexValidationMessages(messages: unknown[] | undefined) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null
  }

  const parts = messages
    .map((entry) => {
      const row = entry as Record<string, unknown>
      const field = typeof row.field === "string" ? row.field : null
      const message = typeof row.message === "string" ? row.message.trim() : ""
      if (!message) return null

      if (field === "employeeToken") {
        return message
      }

      if (field === "consumerToken") {
        return "Tripletex consumer token på serveren er ugyldig. Kontakt support."
      }

      return message
    })
    .filter((value): value is string => Boolean(value))

  return parts.length > 0 ? parts.join(" ") : null
}

function extractTripletexErrorMessage(errorBody: Record<string, unknown> | undefined) {
  if (!errorBody) return null

  const rootValidation = formatTripletexValidationMessages(
    errorBody.validationMessages as unknown[] | undefined
  )
  if (rootValidation) {
    return rootValidation
  }

  const value = errorBody.value as Record<string, unknown> | undefined
  const nestedValidation = formatTripletexValidationMessages(
    value?.validationMessages as unknown[] | undefined
  )
  if (nestedValidation) {
    return nestedValidation
  }

  const candidates: unknown[] = [
    errorBody.message,
    errorBody.error,
    errorBody.description,
    value?.message,
    value?.developerMessage,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const trimmed = candidate.trim()
      if (trimmed.toLowerCase() === "validation failed") {
        continue
      }
      return trimmed
    }
  }

  return null
}

function buildTripletexErrorDetails(error: KnownErrorShape) {
  if (process.env.NODE_ENV === "production") {
    return undefined
  }

  return {
    tripletexMethod: "PUT",
    tripletexBaseUrl: getTripletexApiBaseUrl(),
    tripletexStatus: error.status ?? null,
    applicationName: TRIPLETEX_APPLICATION_NAME,
    note: "POST i Next-loggen er forespørselen fra nettleseren til /api/integrations/tripletex. Tripletex kalles internt med PUT.",
  }
}

function toClientError(error: unknown) {
  const known = error as KnownErrorShape
  const message = error instanceof Error ? error.message : "Ukjent feil"

  if (message.includes("TRIPLETEX_ENCRYPTION_KEY")) {
    return {
      status: 500,
      code: "encryption_key_missing",
      message: "Serverkonfigurasjon mangler TRIPLETEX_ENCRYPTION_KEY.",
    }
  }

  if (message.includes("TRIPLETEX_CONSUMER_TOKEN")) {
    return {
      status: 500,
      code: "consumer_token_missing",
      message: "Tripletex-integrasjonen er ikke konfigurert på serveren.",
    }
  }

  if (known.status === 401 || known.status === 403) {
    const providerMessage = extractTripletexErrorMessage(known.body)
    return {
      status: 400,
      code: "tripletex_auth_failed",
      message: providerMessage || "Tripletex avviste API-brukernøkkelen. Sjekk at nøkkelen er aktiv.",
    }
  }

  if (known.status === 422) {
    const providerMessage = extractTripletexErrorMessage(known.body)
    const validationMessages = known.body?.validationMessages
    const mentionsEmployeeToken =
      providerMessage?.toLowerCase().includes("employee token") ||
      (Array.isArray(validationMessages) &&
        validationMessages.some(
          (entry) =>
            typeof entry === "object" &&
            entry !== null &&
            (entry as Record<string, unknown>).field === "employeeToken"
        ))

    return {
      status: 400,
      code: "tripletex_validation_error",
      message: mentionsEmployeeToken
        ? `API-brukernøkkelen matcher ikke consumer token på serveren. Opprett nøkkelen på nytt i Tripletex med applikasjonsnavn «${TRIPLETEX_APPLICATION_NAME}» (nøyaktig som i godkjennings-e-posten fra Tripletex).`
        : providerMessage ||
          "Tripletex avviste API-brukernøkkelen. Sjekk at nøkkelen er opprettet for riktig applikasjon.",
    }
  }

  if (known.status === 429) {
    return {
      status: 429,
      code: "tripletex_rate_limited",
      message: "Tripletex er rate limited akkurat nå. Prøv igjen om litt.",
    }
  }

  if (known.status && known.status >= 500) {
    return {
      status: 502,
      code: "tripletex_unavailable",
      message: "Tripletex svarte med en serverfeil. Prøv igjen senere.",
    }
  }

  if (message.toLowerCase().includes("fetch failed") || message.toLowerCase().includes("network")) {
    return {
      status: 502,
      code: "tripletex_network_error",
      message: "Kunne ikke kontakte Tripletex. Sjekk nettverk og prøv igjen.",
    }
  }

  return {
    status: 500,
    code: "tripletex_connection_error",
    message,
  }
}

async function resolveCompanyContext() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const admin = createAdminClient()
  const { data: userRow, error: userError } = await admin
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (userError || !userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }

  const role = String(userRow.role || "")

  return {
    companyId: userRow.company_id,
    userId: user.id,
    role,
    isCompanyAdmin: role === "admin",
  }
}

function requireCompanyAdmin(ctx: { isCompanyAdmin: boolean }) {
  if (!ctx.isCompanyAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  return null
}

export async function GET() {
  try {
    const ctx = await resolveCompanyContext()
    if ("error" in ctx) return ctx.error

    const admin = createAdminClient()
    const [connectionResult, jobsResult, recentJobsResult, recentEventsResult] = await Promise.all([
      admin
        .from("tripletex_connections")
        .select("company_id, sync_state, session_expires_at, last_success_at, last_error_at, last_error_message, scope_config, employee_token_enc")
        .eq("company_id", ctx.companyId)
        .maybeSingle(),
      admin
        .from("integration_jobs")
        .select("status")
        .eq("company_id", ctx.companyId)
        .eq("provider", "tripletex"),
      admin
        .from("integration_jobs")
        .select("id, status, job_type, created_at, last_error_message")
        .eq("company_id", ctx.companyId)
        .eq("provider", "tripletex")
        .order("created_at", { ascending: false })
        .limit(12),
      admin
        .from("integration_webhook_events")
        .select("id, event_type, process_status, received_at")
        .eq("company_id", ctx.companyId)
        .eq("provider", "tripletex")
        .order("received_at", { ascending: false })
        .limit(12),
    ])

    const jobs = jobsResult.data || []
    const stats = jobs.reduce(
      (acc, row) => {
        const key = row.status as keyof typeof acc
        if (key in acc) acc[key] += 1
        return acc
      },
      {
        pending: 0,
        processing: 0,
        retry: 0,
        completed: 0,
        failed: 0,
        dead_letter: 0,
      }
    )

    const connection = connectionResult.data
      ? {
          company_id: connectionResult.data.company_id,
          sync_state: connectionResult.data.sync_state,
          session_expires_at: connectionResult.data.session_expires_at,
          last_success_at: connectionResult.data.last_success_at,
          last_error_at: connectionResult.data.last_error_at,
          last_error_message: connectionResult.data.last_error_message,
          scope_config: connectionResult.data.scope_config,
        }
      : null

    return NextResponse.json({
      connection,
      hasApiKey: Boolean(connectionResult.data?.employee_token_enc),
      jobs: stats,
      recentJobs: recentJobsResult.data || [],
      recentEvents: recentEventsResult.data || [],
      connected: Boolean(connection && connection.sync_state !== "disconnected"),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await resolveCompanyContext()
    if ("error" in ctx) return ctx.error
    const forbidden = requireCompanyAdmin(ctx)
    if (forbidden) return forbidden

    const body = await request.json()
    const apiKey = normalizeTripletexApiKey(String(body.apiKey || body.employeeToken || ""))
    const scopeConfig = buildTripletexScopeConfig(body)

    if (!apiKey) {
      return NextResponse.json(
        { error: "API-brukernøkkel må fylles ut.", code: "missing_api_key" },
        { status: 400 }
      )
    }

    if (!hasTripletexConsumerToken()) {
      return NextResponse.json(
        { error: "Tripletex-integrasjonen er ikke konfigurert på serveren.", code: "consumer_token_missing" },
        { status: 500 }
      )
    }

    const consumerToken = resolveTripletexConsumerToken()
    const environmentMismatch = detectTripletexEnvironmentMismatch(consumerToken, apiKey)
    if (environmentMismatch) {
      return NextResponse.json(
        { error: environmentMismatch.message, code: environmentMismatch.code },
        { status: 400 }
      )
    }

    const session = await refreshTripletexSessionFromApiKey(consumerToken, apiKey)
    const encrypted = encryptConnectionTokens({
      consumerToken,
      employeeToken: session.employeeToken,
      sessionToken: session.sessionToken,
    })

    const admin = createAdminClient()
    const { data: existing } = await admin
      .from("tripletex_connections")
      .select("default_account_id, webhook_secret_enc")
      .eq("company_id", ctx.companyId)
      .maybeSingle()

    const { error } = await admin.from("tripletex_connections").upsert({
      company_id: ctx.companyId,
      ...encrypted,
      webhook_secret_enc: existing?.webhook_secret_enc || null,
      session_expires_at: session.expiresAt,
      sync_state: "connected",
      default_vat_type_id: null,
      default_account_id: existing?.default_account_id ?? null,
      scope_config: scopeConfig,
      last_error_at: null,
      last_error_message: null,
      last_success_at: new Date().toISOString(),
    })

    if (error) {
      return NextResponse.json(
        { error: `Kunne ikke lagre Tripletex-tilkobling: ${error.message}`, code: "connection_upsert_failed" },
        { status: 500 }
      )
    }

    if (scopeConfig.customers) {
      await enqueueIntegrationJob({
        companyId: ctx.companyId,
        jobType: "customer.pull_all",
        payload: { source: "connect" },
        idempotencyKey: `customer:pull_all:${ctx.companyId}:${new Date().toISOString()}`,
      })
    }

    await enqueueIntegrationJob({
      companyId: ctx.companyId,
      jobType: "reconcile.full",
      payload: { source: "connect" },
      idempotencyKey: `reconcile:${ctx.companyId}:${new Date().toISOString()}`,
    })

    processTripletexQueueInBackground({ batchSize: 30, maxBatches: 10 })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const mapped = toClientError(error)
    const details = buildTripletexErrorDetails(error as KnownErrorShape)
    return NextResponse.json(
      { error: mapped.message, code: mapped.code, details },
      { status: mapped.status }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await resolveCompanyContext()
    if ("error" in ctx) return ctx.error
    const forbidden = requireCompanyAdmin(ctx)
    if (forbidden) return forbidden

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || "")

    const admin = createAdminClient()
    if (action === "disconnect") {
      const { error } = await admin
        .from("tripletex_connections")
        .update({
          sync_state: "disconnected",
          session_token_enc: null,
          session_expires_at: null,
          last_error_at: null,
          last_error_message: null,
        })
        .eq("company_id", ctx.companyId)

      if (error) {
        return NextResponse.json(
          { error: `Kunne ikke deaktivere integrasjonen: ${error.message}`, code: "disconnect_failed" },
          { status: 500 }
        )
      }

      return NextResponse.json({ ok: true })
    }

    if (action === "connect") {
      const nextScopeConfig = hasTripletexScopeOverride(body) ? buildTripletexScopeConfig(body) : null

      const { data: existing, error: existingError } = await admin
        .from("tripletex_connections")
        .select("consumer_token_enc, employee_token_enc, scope_config")
        .eq("company_id", ctx.companyId)
        .maybeSingle()

      if (existingError || !existing) {
        return NextResponse.json(
          { error: "Fant ingen eksisterende Tripletex-integrasjon å koble til.", code: "connection_missing" },
          { status: 400 }
        )
      }

      const employeeToken = decryptSecret(existing.employee_token_enc)

      if (!employeeToken) {
        return NextResponse.json(
          { error: "Mangler lagret API-brukernøkkel. Lim inn nøkkelen på nytt og koble til.", code: "missing_api_key" },
          { status: 400 }
        )
      }

      const consumerToken = hasTripletexConsumerToken()
        ? resolveTripletexConsumerToken()
        : decryptSecret(existing.consumer_token_enc)

      if (!consumerToken) {
        return NextResponse.json(
          { error: "Tripletex-integrasjonen er ikke konfigurert på serveren.", code: "consumer_token_missing" },
          { status: 500 }
        )
      }

      const session = await refreshTripletexSessionFromApiKey(consumerToken, employeeToken)
      const encrypted = encryptConnectionTokens({
        consumerToken,
        employeeToken: session.employeeToken,
        sessionToken: session.sessionToken,
      })

      const { error: connectError } = await admin
        .from("tripletex_connections")
        .update({
          ...encrypted,
          session_expires_at: session.expiresAt,
          sync_state: "connected",
          scope_config: nextScopeConfig || existing.scope_config,
          last_error_at: null,
          last_error_message: null,
          last_success_at: new Date().toISOString(),
        })
        .eq("company_id", ctx.companyId)

      if (connectError) {
        return NextResponse.json(
          { error: `Kunne ikke koble til integrasjonen: ${connectError.message}`, code: "connect_failed" },
          { status: 500 }
        )
      }

      const scopeConfig = existing.scope_config || {}
      if (scopeConfig.customers !== false) {
        await enqueueIntegrationJob({
          companyId: ctx.companyId,
          jobType: "customer.pull_all",
          payload: { source: "reconnect" },
          idempotencyKey: `customer:pull_all:${ctx.companyId}:${new Date().toISOString()}`,
        })
      }

      await enqueueIntegrationJob({
        companyId: ctx.companyId,
        jobType: "reconcile.full",
        payload: { source: "reconnect" },
        idempotencyKey: `reconcile:${ctx.companyId}:${new Date().toISOString()}`,
      })

      processTripletexQueueInBackground({ batchSize: 30, maxBatches: 10 })

      return NextResponse.json({ ok: true })
    }

    if (action === "update_scope") {
      const scopeConfig = buildTripletexScopeConfig(body)

      const { error: scopeError } = await admin
        .from("tripletex_connections")
        .update({ scope_config: scopeConfig })
        .eq("company_id", ctx.companyId)

      if (scopeError) {
        return NextResponse.json(
          { error: `Kunne ikke oppdatere synkomfang: ${scopeError.message}`, code: "scope_update_failed" },
          { status: 500 }
        )
      }

      return NextResponse.json({ ok: true, scopeConfig })
    }

    if (action === "sync_now") {
      const { data: connection, error: connectionError } = await admin
        .from("tripletex_connections")
        .select("sync_state, scope_config")
        .eq("company_id", ctx.companyId)
        .maybeSingle()

      if (connectionError || !connection) {
        return NextResponse.json(
          { error: "Fant ingen Tripletex-tilkobling.", code: "connection_missing" },
          { status: 400 }
        )
      }

      if (connection.sync_state === "disconnected") {
        return NextResponse.json(
          { error: "Tripletex er frakoblet. Koble til før du synkroniserer.", code: "disconnected" },
          { status: 400 }
        )
      }

      const runKey = new Date().toISOString()
      const scopeConfig = (connection.scope_config || {}) as { customers?: boolean }

      if (scopeConfig.customers !== false) {
        await enqueueIntegrationJob({
          companyId: ctx.companyId,
          jobType: "customer.pull_all",
          payload: { source: "manual_sync" },
          idempotencyKey: `customer:pull_all:${ctx.companyId}:${runKey}`,
        })
      }

      await enqueueIntegrationJob({
        companyId: ctx.companyId,
        jobType: "reconcile.full",
        payload: { source: "manual_sync" },
        idempotencyKey: `reconcile:${ctx.companyId}:${runKey}`,
      })

      processTripletexQueueInBackground({ batchSize: 30, maxBatches: 15 })

      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "Ugyldig handling", code: "invalid_action" }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil"
    return NextResponse.json({ error: message, code: "disconnect_error" }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const ctx = await resolveCompanyContext()
    if ("error" in ctx) return ctx.error
    const forbidden = requireCompanyAdmin(ctx)
    if (forbidden) return forbidden

    const admin = createAdminClient()
    const { error } = await admin
      .from("tripletex_connections")
      .delete()
      .eq("company_id", ctx.companyId)

    if (error) {
      return NextResponse.json(
        { error: `Kunne ikke fjerne integrasjonen: ${error.message}`, code: "delete_failed" },
        { status: 500 }
      )
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil"
    return NextResponse.json({ error: message, code: "delete_error" }, { status: 500 })
  }
}
