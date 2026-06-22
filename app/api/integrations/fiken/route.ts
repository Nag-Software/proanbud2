import { NextResponse } from "next/server"

import { createClient as createServerSupabase } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { encryptSecret } from "@/lib/integrations/shared/crypto"
import { getFikenCompanies } from "@/lib/integrations/fiken/connector"
import { enqueueFikenJob } from "@/lib/integrations/fiken/jobs"
import { buildFikenScopeConfig } from "@/lib/integrations/fiken/scopes"
import { processFikenQueueInBackground } from "@/lib/integrations/fiken/sync"

function encryptFikenToken(value: string) {
  return encryptSecret(value, ["FIKEN_ENCRYPTION_KEY", "TRIPLETEX_ENCRYPTION_KEY"])
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
    companyId: userRow.company_id as string,
    userId: user.id,
    role,
    isCompanyAdmin: role === "admin",
    canManage: role === "admin" || role === "manager",
  }
}

export async function GET() {
  try {
    const ctx = await resolveCompanyContext()
    if ("error" in ctx) return ctx.error

    const admin = createAdminClient()
    const [connectionResult, jobsResult, recentJobsResult, tripletexResult] = await Promise.all([
      admin
        .from("fiken_connections")
        .select(
          "company_id, sync_state, token_expires_at, fiken_company_slug, fiken_company_name, is_test_company, last_success_at, last_error_at, last_error_message, last_payment_poll_date, scope_config"
        )
        .eq("company_id", ctx.companyId)
        .maybeSingle(),
      admin.from("integration_jobs").select("status").eq("company_id", ctx.companyId).eq("provider", "fiken"),
      admin
        .from("integration_jobs")
        .select("id, status, job_type, created_at, last_error_message")
        .eq("company_id", ctx.companyId)
        .eq("provider", "fiken")
        .order("created_at", { ascending: false })
        .limit(15),
      admin
        .from("tripletex_connections")
        .select("sync_state")
        .eq("company_id", ctx.companyId)
        .maybeSingle(),
    ])

    const jobs = jobsResult.data || []
    const stats = jobs.reduce(
      (acc, row) => {
        const key = row.status as keyof typeof acc
        if (key in acc) acc[key] += 1
        return acc
      },
      { pending: 0, processing: 0, retry: 0, completed: 0, failed: 0, dead_letter: 0 }
    )

    const connection = connectionResult.data || null
    const tripletexConnected = Boolean(
      tripletexResult.data && tripletexResult.data.sync_state !== "disconnected"
    )

    return NextResponse.json({
      connection,
      connected: Boolean(connection && connection.sync_state !== "disconnected"),
      jobs: stats,
      recentJobs: recentJobsResult.data || [],
      // Only one accounting provider may be connected at a time.
      conflictingProvider: tripletexConnected && !connection ? "tripletex" : null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

/**
 * Connect with a personal API token (own-company testing). No env vars / OAuth app
 * required. Fiken's ToS restricts personal tokens to your OWN company — for connecting
 * customers' Fiken accounts, use the OAuth flow instead.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveCompanyContext()
    if ("error" in ctx) return ctx.error
    if (!ctx.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const personalToken = String(body?.personalToken || "").trim()
    const requestedSlug = body?.companySlug ? String(body.companySlug) : null

    if (!personalToken) {
      return NextResponse.json({ error: "Lim inn en personlig API-nøkkel.", code: "missing_token" }, { status: 400 })
    }

    const admin = createAdminClient()

    // Mutual exclusivity: only one accounting provider at a time.
    const { data: tripletex } = await admin
      .from("tripletex_connections")
      .select("sync_state")
      .eq("company_id", ctx.companyId)
      .maybeSingle()
    if (tripletex && tripletex.sync_state !== "disconnected") {
      return NextResponse.json(
        {
          error: "Tripletex er allerede tilkoblet. Koble fra Tripletex først — du kan kun ha ett regnskapssystem.",
          code: "accounting_conflict",
        },
        { status: 400 }
      )
    }

    // Validate the token by listing the companies it can access.
    let companies
    try {
      companies = await getFikenCompanies(personalToken)
    } catch {
      return NextResponse.json(
        { error: "Fiken avviste API-nøkkelen. Sjekk at den er riktig og at API-modulen er aktivert.", code: "token_invalid" },
        { status: 400 }
      )
    }

    const withSlug = companies.filter((c) => c.slug)
    if (withSlug.length === 0) {
      return NextResponse.json({ error: "Fant ingen Fiken-selskap for denne nøkkelen.", code: "no_company" }, { status: 400 })
    }

    // If the token grants multiple companies and none was chosen, ask the UI to pick.
    if (!requestedSlug && withSlug.length > 1) {
      return NextResponse.json({
        needsCompanySelection: true,
        companies: withSlug.map((c) => ({
          slug: c.slug,
          name: c.name || c.slug,
          testCompany: c.testCompany === true,
          hasApiAccess: c.hasApiAccess !== false,
        })),
      })
    }

    const company = requestedSlug ? withSlug.find((c) => c.slug === requestedSlug) : withSlug[0]
    if (!company?.slug) {
      return NextResponse.json({ error: "Ugyldig valg av Fiken-selskap.", code: "invalid_company" }, { status: 400 })
    }

    const { error: upsertError } = await admin.from("fiken_connections").upsert(
      {
        company_id: ctx.companyId,
        auth_mode: "personal",
        personal_token_enc: encryptFikenToken(personalToken),
        access_token_enc: null,
        refresh_token_enc: null,
        token_expires_at: null,
        fiken_company_slug: company.slug,
        fiken_company_name: company.name || null,
        is_test_company: company.testCompany === true,
        sync_state: "connected",
        last_success_at: new Date().toISOString(),
        last_error_at: null,
        last_error_message: null,
      },
      { onConflict: "company_id" }
    )

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message, code: "save_failed" }, { status: 500 })
    }

    await enqueueFikenJob({
      companyId: ctx.companyId,
      jobType: "reconcile.full",
      payload: { source: "connect_personal" },
      idempotencyKey: `fiken:reconcile:${ctx.companyId}:${new Date().toISOString()}`,
    })
    processFikenQueueInBackground({ batchSize: 5, maxBatches: 10 })

    return NextResponse.json({
      ok: true,
      company: { slug: company.slug, name: company.name || null, testCompany: company.testCompany === true },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await resolveCompanyContext()
    if ("error" in ctx) return ctx.error
    if (!ctx.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const action = String(body?.action || "")
    const admin = createAdminClient()

    if (action === "disconnect") {
      const { error } = await admin
        .from("fiken_connections")
        .update({
          sync_state: "disconnected",
          access_token_enc: null,
          token_expires_at: null,
          last_error_at: null,
          last_error_message: null,
        })
        .eq("company_id", ctx.companyId)

      if (error) {
        return NextResponse.json({ error: error.message, code: "disconnect_failed" }, { status: 500 })
      }
      return NextResponse.json({ ok: true })
    }

    if (action === "update_scope") {
      const scopeConfig = buildFikenScopeConfig(body)
      const { error } = await admin
        .from("fiken_connections")
        .update({ scope_config: scopeConfig })
        .eq("company_id", ctx.companyId)

      if (error) {
        return NextResponse.json({ error: error.message, code: "scope_update_failed" }, { status: 500 })
      }
      return NextResponse.json({ ok: true, scopeConfig })
    }

    if (action === "sync_now") {
      const { data: connection, error } = await admin
        .from("fiken_connections")
        .select("sync_state")
        .eq("company_id", ctx.companyId)
        .maybeSingle()

      if (error || !connection) {
        return NextResponse.json({ error: "Fant ingen Fiken-tilkobling.", code: "connection_missing" }, { status: 400 })
      }
      if (connection.sync_state === "disconnected") {
        return NextResponse.json({ error: "Fiken er frakoblet.", code: "disconnected" }, { status: 400 })
      }

      const runKey = new Date().toISOString()
      await enqueueFikenJob({
        companyId: ctx.companyId,
        jobType: "reconcile.full",
        payload: { source: "manual_sync" },
        idempotencyKey: `fiken:reconcile:${ctx.companyId}:${runKey}`,
      })

      processFikenQueueInBackground({ batchSize: 5, maxBatches: 15 })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: "Ugyldig handling", code: "invalid_action" }, { status: 400 })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE() {
  try {
    const ctx = await resolveCompanyContext()
    if ("error" in ctx) return ctx.error
    if (!ctx.canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const admin = createAdminClient()
    const { error } = await admin.from("fiken_connections").delete().eq("company_id", ctx.companyId)

    if (error) {
      return NextResponse.json({ error: error.message, code: "delete_failed" }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ukjent feil"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
