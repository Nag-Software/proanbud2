// Kjøremotoren for fase 1: køing, research og utkast.
//
// Køene er domenetabellene selv, ikke en generisk jobbtabell:
//   research-kø = prospects.pipeline_state = 'venter_research'
//   utkastskø   = prospects.pipeline_state = 'kvalifisert' uten levende melding
//
// Hvert steg er tidsbokset og har et budsjett. Går tiden eller pengene, stopper
// kjøringen pent og lar neste tick ta resten — en halv jobb som kan gjenopptas
// er bedre enn en timeout midt i et LLM-kall.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import type { Hook } from "@/lib/outreach/research/synthesize"
import { researchProspect } from "@/lib/outreach/research/run"
import { loadSettings } from "@/lib/outreach/settings"
import type { ProspectRow } from "@/lib/outreach/types"
import { draftMessage, persistDraft } from "@/lib/outreach/write/generate"

export type StepResult = {
  attempted: number
  succeeded: number
  failed: number
  cost_usd: number
  notes: string[]
}

const emptyStep = (): StepResult => ({ attempted: 0, succeeded: 0, failed: 0, cost_usd: 0, notes: [] })

/**
 * Melder prospekter inn i research-køen. Bare de som faktisk kan få e-post —
 * `contact_policy = 'epost_ok'` — er verdt en researchkostnad.
 */
export async function queueForResearch(options: {
  segment?: string | null
  limit?: number
}): Promise<{ queued: number }> {
  const admin = createAdminClient()
  const limit = Math.max(1, Math.min(options.limit ?? 30, 100))

  let query = admin
    .from("prospects")
    .select("id")
    .eq("pipeline_state", "kilde")
    .eq("contact_policy", "epost_ok")
    .order("created_at", { ascending: true })
    .limit(limit)

  if (options.segment) query = query.eq("segment", options.segment)

  const { data, error } = await query
  if (error || !data || data.length === 0) return { queued: 0 }

  const ids = data.map((row) => row.id as string)
  const { error: updateError } = await admin
    .from("prospects")
    .update({ pipeline_state: "venter_research", research_attempts: 0, research_error: null })
    .in("id", ids)

  if (updateError) {
    void logServerError({
      message: "Kunne ikke kø prospekter til research",
      level: "warning",
      source: "worker",
      error: updateError,
    })
    return { queued: 0 }
  }

  return { queued: ids.length }
}

/**
 * Tar og kjører research. Claim-RPC-en bruker `for update skip locked`, så to
 * overlappende ticks aldri tar samme prospekt.
 */
export async function runResearchBatch(options: {
  limit?: number
  segment?: string | null
  deadline: number
  budgetUsd: number
}): Promise<StepResult> {
  const result = emptyStep()
  const admin = createAdminClient()

  const { data, error } = await admin.rpc("claim_research_prospects", {
    p_limit: Math.max(1, Math.min(options.limit ?? 5, 20)),
    p_lease_minutes: 10,
    p_segment: options.segment ?? null,
  })

  if (error) {
    result.notes.push(`Kunne ikke ta researchjobber: ${error.message}`)
    return result
  }

  const claimed = (data ?? []) as ProspectRow[]
  for (const prospect of claimed) {
    if (Date.now() > options.deadline) {
      result.notes.push("Tiden gikk ut — resten tas neste kjøring")
      // Rullen tilbake til køen, så leasen ikke må løpe ut først.
      await admin
        .from("prospects")
        .update({ pipeline_state: "venter_research", research_locked_at: null })
        .eq("id", prospect.id)
        .eq("pipeline_state", "research")
      break
    }
    if (result.cost_usd >= options.budgetUsd) {
      result.notes.push("LLM-budsjettet er brukt opp for i dag")
      await admin
        .from("prospects")
        .update({ pipeline_state: "venter_research", research_locked_at: null })
        .eq("id", prospect.id)
        .eq("pipeline_state", "research")
      break
    }

    result.attempted += 1
    const outcome = await researchProspect(prospect.id)
    result.cost_usd += outcome.cost_usd
    if (outcome.ok) result.succeeded += 1
    else {
      result.failed += 1
      if (outcome.reason) result.notes.push(`${prospect.name}: ${outcome.reason}`)
    }
  }

  return result
}

type ResearchRow = {
  id: string
  hooks: Hook[] | null
  summary: string | null
  pains: string[] | null
  best_angle: string | null
}

/**
 * Skriver utkast for kvalifiserte prospekter som ikke allerede har et.
 *
 * Antallet begrenses av `daily_new_drafts` — det nytter ikke å lage 200 utkast
 * hvis Casper rekker å gå gjennom 20. Resten ville bare utløpt.
 */
export async function runDraftBatch(options: {
  limit?: number
  segment?: string | null
  deadline: number
  budgetUsd: number
}): Promise<StepResult> {
  const result = emptyStep()
  const admin = createAdminClient()
  const settings = await loadSettings()

  // Hvor mange utkast venter allerede? Køen skal ikke vokse forbi kapasiteten.
  const { count: pending } = await admin
    .from("outreach_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "til_godkjenning")

  const room = Math.max(0, settings.daily_new_drafts - (pending ?? 0))
  if (room === 0) {
    result.notes.push(`Godkjenningskøen er full (${pending} venter)`)
    return result
  }

  let query = admin
    .from("prospects")
    .select("*")
    .eq("pipeline_state", "kvalifisert")
    .not("research_id", "is", null)
    .order("fit_score", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: true })
    .limit(Math.min(options.limit ?? room, room))

  if (options.segment) query = query.eq("segment", options.segment)

  const { data, error } = await query
  if (error) {
    result.notes.push(`Kunne ikke hente kvalifiserte prospekter: ${error.message}`)
    return result
  }

  for (const prospect of (data ?? []) as ProspectRow[]) {
    if (Date.now() > options.deadline) {
      result.notes.push("Tiden gikk ut — resten tas neste kjøring")
      break
    }
    if (result.cost_usd >= options.budgetUsd) {
      result.notes.push("LLM-budsjettet er brukt opp for i dag")
      break
    }

    result.attempted += 1
    const outcome = await draftOne(prospect)
    result.cost_usd += outcome.cost_usd
    if (outcome.ok) result.succeeded += 1
    else {
      result.failed += 1
      result.notes.push(`${prospect.name}: ${outcome.reason}`)
    }
  }

  return result
}

/** Skriver ett utkast for ett prospekt. Brukes både av køen og fra lead-kortet. */
export async function draftOne(
  prospect: ProspectRow,
  step = 1,
): Promise<{ ok: boolean; reason: string; cost_usd: number; messageId?: string }> {
  const admin = createAdminClient()
  const settings = await loadSettings()

  if (!prospect.research_id) {
    return { ok: false, reason: "Prospektet har ingen research", cost_usd: 0 }
  }

  const { data: research } = await admin
    .from("prospect_research")
    .select("id, hooks, summary, pains, best_angle")
    .eq("id", prospect.research_id)
    .maybeSingle<ResearchRow>()

  if (!research) return { ok: false, reason: "Fant ikke dossieret", cost_usd: 0 }

  const previous =
    step > 1
      ? await admin
          .from("outreach_messages")
          .select("subject, body_ai, body_final")
          .eq("prospect_id", prospect.id)
          .eq("step", 1)
          .maybeSingle()
      : null

  const draft = await draftMessage({
    prospect,
    hooks: research.hooks ?? [],
    summary: research.summary,
    pains: research.pains ?? [],
    bestAngle: research.best_angle,
    step,
    previousSubject: previous?.data?.subject ?? null,
    previousBody: previous?.data?.body_final ?? previous?.data?.body_ai ?? null,
  })

  if (!draft.ok) {
    // Et utkast som ikke består kvalitetssjekken sendes aldri. Prospektet
    // havner i «trenger deg»-lista i stedet for i en generisk e-post.
    await admin
      .from("prospects")
      .update({ pipeline_state: "for_tynn", research_error: draft.reason })
      .eq("id", prospect.id)
      .eq("pipeline_state", "kvalifisert")
    return { ok: false, reason: draft.reason, cost_usd: draft.cost_usd }
  }

  const saved = await persistDraft({
    prospectId: prospect.id,
    researchId: research.id,
    step,
    draft,
    ttlDays: settings.draft_ttl_days,
  })

  if (!saved) {
    return { ok: false, reason: "Utkastet finnes allerede for dette steget", cost_usd: draft.cost_usd }
  }

  return { ok: true, reason: "", cost_usd: draft.cost_usd, messageId: saved.id }
}

// ── Én kjøring ──────────────────────────────────────────────────────────────

export type RunSummary = {
  ok: boolean
  queued: number
  research: StepResult
  drafts: StepResult
  cost_usd: number
  duration_ms: number
  paused: boolean
  notes: string[]
}

/**
 * «Kjør nå»: køer opp, researcher og skriver, innenfor en tidsboks.
 *
 * Rekkefølgen er research før skriving, fordi et dossier fra denne kjøringen
 * skal kunne bli et utkast i den samme kjøringen — Casper skal ikke vente på
 * neste tick for å se resultatet.
 */
export async function runPipeline(options: {
  segment?: string | null
  queueLimit?: number
  budgetMs?: number
}): Promise<RunSummary> {
  const started = Date.now()
  const budgetMs = options.budgetMs ?? 240_000
  const deadline = started + budgetMs
  const settings = await loadSettings()

  const { queued } = await queueForResearch({
    segment: options.segment,
    limit: options.queueLimit ?? 30,
  })

  const research = await runResearchBatch({
    segment: options.segment,
    deadline: deadline - 30_000,
    budgetUsd: settings.llm_daily_budget_usd,
    limit: 8,
  })

  const drafts = await runDraftBatch({
    segment: options.segment,
    deadline,
    budgetUsd: Math.max(0, settings.llm_daily_budget_usd - research.cost_usd),
  })

  return {
    ok: true,
    queued,
    research,
    drafts,
    cost_usd: research.cost_usd + drafts.cost_usd,
    duration_ms: Date.now() - started,
    paused: settings.paused,
    notes: [...research.notes, ...drafts.notes],
  }
}
