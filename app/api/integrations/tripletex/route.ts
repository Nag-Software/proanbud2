import { NextResponse } from "next/server"

import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  encryptConnectionTokens,
  refreshTripletexSession,
} from "@/lib/integrations/tripletex/connector"
import { decryptSecret, encryptSecret } from "@/lib/integrations/tripletex/crypto"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"
import { processTripletexQueueInBackground } from "@/lib/integrations/tripletex/sync"

type KnownErrorShape = Error & {
  status?: number
  body?: Record<string, unknown>
}

function extractTripletexErrorMessage(errorBody: Record<string, unknown> | undefined) {
  if (!errorBody) return null

  const value = errorBody.value as Record<string, unknown> | undefined
  const validationMessages = value?.validationMessages as unknown[] | undefined
  const firstValidation =
    Array.isArray(validationMessages) && validationMessages.length > 0
      ? (validationMessages[0] as Record<string, unknown>)
      : undefined

  const candidates: unknown[] = [
    errorBody.message,
    errorBody.error,
    errorBody.description,
    value?.message,
    value?.developerMessage,
    firstValidation?.message,
    firstValidation?.developerMessage,
  ]

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim()
    }
  }

  return null
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

  if (known.status === 401 || known.status === 403) {
    const providerMessage = extractTripletexErrorMessage(known.body)
    return {
      status: 400,
      code: "tripletex_auth_failed",
      message: providerMessage || "Tripletex avviste tokenene. Sjekk consumer token og employee token.",
    }
  }

  if (known.status === 422) {
    const providerMessage = extractTripletexErrorMessage(known.body)
    return {
      status: 400,
      code: "tripletex_validation_error",
      message: providerMessage || "Tripletex avviste forespoerselen. Sjekk token-format og verdier.",
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
    const [connectionResult, jobsResult] = await Promise.all([
      admin
        .from("tripletex_connections")
        .select("company_id, sync_state, session_expires_at, default_account_id, last_success_at, last_error_at, last_error_message, scope_config, consumer_token_enc, employee_token_enc, webhook_secret_enc")
        .eq("company_id", ctx.companyId)
        .maybeSingle(),
      admin
        .from("integration_jobs")
        .select("status")
        .eq("company_id", ctx.companyId)
        .eq("provider", "tripletex"),
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

    const canViewSecrets = ctx.isCompanyAdmin

    const connection = connectionResult.data
      ? {
          ...connectionResult.data,
          consumer_token:
            canViewSecrets && connectionResult.data.consumer_token_enc
            ? decryptSecret(connectionResult.data.consumer_token_enc)
            : "",
          employee_token:
            canViewSecrets && connectionResult.data.employee_token_enc
            ? decryptSecret(connectionResult.data.employee_token_enc)
            : "",
          webhook_secret:
            canViewSecrets && connectionResult.data.webhook_secret_enc
            ? decryptSecret(connectionResult.data.webhook_secret_enc)
            : "",
        }
      : null

    return NextResponse.json({
      connection,
      jobs: stats,
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
    const consumerToken = String(body.consumerToken || "").trim()
    const employeeToken = String(body.employeeToken || "").trim()
    const webhookSecret = String(body.webhookSecret || "").trim()
    const defaultAccountId = body.defaultAccountId ? Number(body.defaultAccountId) : null
    const scopeConfig = {
      customers: body.scopeCustomers !== false,
      projects: body.scopeProjects !== false,
      offers: body.scopeOffers !== false,
      invoices: body.scopeInvoices !== false,
      employees: body.scopeEmployees === true,
      calendar: body.scopeCalendar === true,
      documents: body.scopeDocuments === true,
    }

    if (!consumerToken || !employeeToken) {
      return NextResponse.json(
        { error: "Både consumer token og employee token må fylles ut.", code: "missing_tokens" },
        { status: 400 }
      )
    }

    const session = await refreshTripletexSession(consumerToken, employeeToken)
    const encrypted = encryptConnectionTokens({
      consumerToken,
      employeeToken,
      sessionToken: session.sessionToken,
    })

    const admin = createAdminClient()
    const { error } = await admin.from("tripletex_connections").upsert({
      company_id: ctx.companyId,
      ...encrypted,
      webhook_secret_enc: webhookSecret ? encryptSecret(webhookSecret) : null,
      session_expires_at: session.expiresAt,
      sync_state: "connected",
      default_vat_type_id: null,
      default_account_id: Number.isFinite(defaultAccountId) ? defaultAccountId : null,
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
    return NextResponse.json({ error: mapped.message, code: mapped.code }, { status: mapped.status })
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

      const consumerToken = decryptSecret(existing.consumer_token_enc)
      const employeeToken = decryptSecret(existing.employee_token_enc)

      if (!consumerToken || !employeeToken) {
        return NextResponse.json(
          { error: "Mangler gyldige lagrede tokens. Legg inn tokenene på nytt og lagre tilkobling.", code: "missing_tokens" },
          { status: 400 }
        )
      }

      const session = await refreshTripletexSession(consumerToken, employeeToken)
      const encrypted = encryptConnectionTokens({
        consumerToken,
        employeeToken,
        sessionToken: session.sessionToken,
      })

      const { error: connectError } = await admin
        .from("tripletex_connections")
        .update({
          ...encrypted,
          session_expires_at: session.expiresAt,
          sync_state: "connected",
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
      const scopeConfig = {
        customers: body.scopeCustomers !== false,
        projects: body.scopeProjects !== false,
        offers: body.scopeOffers !== false,
        invoices: body.scopeInvoices !== false,
        employees: body.scopeEmployees === true,
        calendar: body.scopeCalendar === true,
        documents: body.scopeDocuments === true,
      }

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
