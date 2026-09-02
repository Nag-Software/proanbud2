import { NextResponse } from "next/server"

import { companyHasFeature } from "@/lib/billing/server-modules"
import { logServerError } from "@/lib/errors/log"
import { CAPABILITIES, SCOPE_ITEMS } from "@/lib/regnskap/capabilities"
import { getActiveAccountingProvider, getAdapter } from "@/lib/regnskap/registry"
import { scopesFromRequestBody } from "@/lib/regnskap/scopes"
import { ACCOUNTING_PROVIDER_LABELS } from "@/lib/regnskap/types"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient as createServerSupabase } from "@/lib/supabase/server"

/**
 * Leverandøruavhengig regnskaps-API.
 *
 * Innstillingssidene for Fiken og Tripletex eier fortsatt selve TILKOBLINGEN —
 * OAuth og API-nøkkel er reelt forskjellige. Alt etter tilkoblingen er likt, og
 * ligger her: status, synkomfang, kjør kø, prøv feilede på nytt, hent kunder.
 */

async function resolveContext() {
  const supabase = await createServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const admin = createAdminClient()
  const { data: userRow } = await admin
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }

  const role = String(userRow.role || "")
  if (!(await companyHasFeature(userRow.company_id, "integrasjoner"))) {
    return {
      error: NextResponse.json(
        {
          error: "Integrasjoner er inkludert i Proff eller kan aktiveres som modul.",
          code: "plan_required",
          feature: "integrasjoner",
        },
        { status: 403 }
      ),
    }
  }

  return { admin, companyId: userRow.company_id as string, role }
}

function requireManager(role: string) {
  return ["admin", "manager"].includes(role)
    ? null
    : NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

export async function GET() {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const active = await getActiveAccountingProvider(ctx.companyId)

  if (!active) {
    return NextResponse.json({ ok: true, connected: false, provider: null, jobs: [], stats: null })
  }

  const provider = active.adapter.id
  const [{ data: jobs }, { data: allJobs }] = await Promise.all([
    ctx.admin
      .from("integration_jobs")
      .select("id, job_type, status, last_error_message, created_at, updated_at")
      .eq("company_id", ctx.companyId)
      .eq("provider", provider)
      .order("created_at", { ascending: false })
      .limit(50),
    ctx.admin
      .from("integration_jobs")
      .select("status")
      .eq("company_id", ctx.companyId)
      .eq("provider", provider)
      .limit(1000),
  ])

  const counts = (allJobs || []).reduce<Record<string, number>>((acc, row) => {
    const key = String(row.status)
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  return NextResponse.json({
    ok: true,
    connected: true,
    provider,
    providerLabel: ACCOUNTING_PROVIDER_LABELS[provider],
    state: active.state,
    capabilities: CAPABILITIES[provider],
    scopeItems: SCOPE_ITEMS,
    jobs: jobs || [],
    stats: {
      queued: (counts.pending || 0) + (counts.retry || 0),
      processing: counts.processing || 0,
      failed: (counts.failed || 0) + (counts.dead_letter || 0),
    },
  })
}

export async function PATCH(request: Request) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const forbidden = requireManager(ctx.role)
  if (forbidden) return forbidden

  const active = await getActiveAccountingProvider(ctx.companyId)
  if (!active) {
    return NextResponse.json(
      { error: "Ingen regnskapsintegrasjon er tilkoblet." },
      { status: 400 }
    )
  }

  const adapter = getAdapter(active.adapter.id)
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const action = String(body.action || "")

  try {
    switch (action) {
      case "update_scope": {
        const next = scopesFromRequestBody(adapter.id, body, active.state.scopes)
        await adapter.updateScopes(ctx.companyId, next)
        return NextResponse.json({ ok: true, scopes: next })
      }

      case "sync_now": {
        // Avstemming OG betalingssjekk — samme handling uansett leverandør.
        const reconciled = await adapter.enqueueReconcile(ctx.companyId, "manual")
        await adapter.enqueuePaymentPoll(ctx.companyId, "manual")
        if (!reconciled) {
          return NextResponse.json(
            { error: "Tilkoblingen er ikke ferdig satt opp ennå." },
            { status: 400 }
          )
        }
        adapter.processQueueInBackground()
        return NextResponse.json({ ok: true })
      }

      case "pull_customers": {
        const enqueued = await adapter.enqueueCustomerPull(ctx.companyId, "manual")
        if (!enqueued) {
          return NextResponse.json(
            { error: `${ACCOUNTING_PROVIDER_LABELS[adapter.id]} kan ikke hente kunder ennå.` },
            { status: 400 }
          )
        }
        adapter.processQueueInBackground()
        return NextResponse.json({ ok: true })
      }

      case "retry_failed": {
        // `ambiguous_create` og `reaped_stuck` holdes UTENFOR: der vet vi ikke om
        // kallet allerede opprettet en ekte faktura, og et nytt forsøk kunne laget
        // faktura nummer to på samme arbeid. De må ryddes manuelt.
        const { data, error } = await ctx.admin
          .from("integration_jobs")
          .update({ status: "retry", next_run_at: new Date().toISOString() })
          .eq("company_id", ctx.companyId)
          .eq("provider", adapter.id)
          .in("status", ["failed", "dead_letter"])
          .not("last_error_code", "in", "(ambiguous_create,reaped_stuck)")
          .select("id")

        if (error) throw new Error(error.message)
        adapter.processQueueInBackground()
        return NextResponse.json({ ok: true, requeued: (data || []).length })
      }

      default:
        return NextResponse.json({ error: `Ukjent handling: ${action}` }, { status: 400 })
    }
  } catch (error) {
    await logServerError({
      message: "Regnskaps-API feilet",
      error,
      source: "api",
      route: "PATCH /api/integrations/regnskap",
      context: { action, provider: adapter.id },
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ukjent feil" },
      { status: 500 }
    )
  }
}
