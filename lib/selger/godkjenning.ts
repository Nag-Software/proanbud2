// Data til godkjenningsflaten.
//
// Ett spørsmål, alt Casper trenger for å ta 20 avgjørelser på 15 minutter:
// utkastet, dossieret som begrunner det, og kilden hver påstand kom fra.
// Alt som krever et ekstra klikk for å etterprøve, blir ikke etterprøvd.

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import type { Hook } from "@/lib/outreach/research/synthesize"
import type { FitCriterion } from "@/lib/outreach/research/synthesize"
import type { LintIssue } from "@/lib/outreach/write/lint"
import { TRADE_LABELS, type TradeKey } from "@/lib/outreach/segments"
import {
  ANALYSE_FACT_COLUMNS,
  analyseFactsFrom,
  type AnalyseFacts,
  type AnalyseLeadRecord,
} from "@/lib/outreach/varm-regler"

export type ResearchSourceRow = {
  kind: string
  url: string
  ok: boolean
  fetched_at: string
}

export type ApprovalDossier = {
  id: string
  summary: string | null
  best_angle: string | null
  pains: string[]
  disqualifiers: string[]
  hooks: Hook[]
  criteria: FitCriterion[]
  sources: ResearchSourceRow[]
  verdict: string
  cost_usd: number | null
  created_at: string
  regnskap: {
    aar: number | null
    driftsinntekter: number | null
    vekst: number | null
  } | null
}

export type ApprovalItem = {
  message: {
    id: string
    step: number
    /** «varm» = oppfølging av en analyse med samtykke. Ellers kald post. */
    kind: string
    subject: string
    body: string
    /** KI-originalen, alltid — også når Casper har redigert. */
    body_ai: string
    angle: string | null
    hook_id: string | null
    grade: number | null
    grade_report: {
      score: number
      spesifisitet: number
      tone: number
      cta: number
      begrunnelse: string
      forslag: string[]
    } | null
    lint_issues: LintIssue[]
    expires_at: string | null
    created_at: string
  }
  prospect: {
    id: string
    name: string
    org_number: string | null
    email: string | null
    website: string | null
    city: string | null
    kommune: string | null
    employee_count: number | null
    segment: string
    trade: string | null
    trade_label: string
    fit_score: number | null
    fit_tier: string | null
    contact_policy: string | null
    email_kind: string | null
    /** Adressen som ga samtykke — varm post går dit, ikke til `email`. */
    consent_email: string | null
  }
  dossier: ApprovalDossier | null
  /** Analysen den varme oppfølgingen bygger på. Null for kald post. */
  analyse: AnalyseFacts | null
}

type RawRow = Record<string, unknown>

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function mapDossier(row: RawRow | null): ApprovalDossier | null {
  if (!row) return null
  const fit = asRecord(row.fit)
  const facts = asRecord(row.facts)
  const regnskap = asRecord(facts.regnskap)
  const siste = asRecord(regnskap.siste)

  return {
    id: String(row.id),
    summary: (row.summary as string) ?? null,
    best_angle: (row.best_angle as string) ?? null,
    pains: Array.isArray(row.pains) ? (row.pains as string[]) : [],
    disqualifiers: Array.isArray(row.disqualifiers) ? (row.disqualifiers as string[]) : [],
    hooks: Array.isArray(row.hooks) ? (row.hooks as Hook[]) : [],
    criteria: Array.isArray(fit.criteria) ? (fit.criteria as FitCriterion[]) : [],
    sources: Array.isArray(row.sources) ? (row.sources as ResearchSourceRow[]) : [],
    verdict: String(row.verdict ?? "for_tynn"),
    cost_usd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    created_at: String(row.created_at),
    regnskap:
      Object.keys(regnskap).length > 0
        ? {
            aar: (siste.aar as number) ?? null,
            driftsinntekter: (siste.driftsinntekter as number) ?? null,
            vekst: (regnskap.vekst as number) ?? null,
          }
        : null,
  }
}

/**
 * Utkastene som venter, best først. Fit-score styrer rekkefølgen, slik at
 * Casper bruker de skarpeste minuttene på de beste firmaene — og de som
 * uansett blir avvist kan stå bakerst.
 */
export async function fetchApprovalQueue(options: {
  segment?: string | null
  limit?: number
} = {}): Promise<ApprovalItem[]> {
  const admin = createAdminClient()

  try {
    let query = admin
      .from("outreach_messages")
      .select(
        `id, step, kind, subject, body_ai, body_final, angle, hook_id, grade, grade_report, lint,
         expires_at, created_at, research_id,
         prospects!inner (*)`,
      )
      .eq("status", "til_godkjenning")
      .order("created_at", { ascending: true })
      .limit(options.limit ?? 50)

    if (options.segment) query = query.eq("prospects.segment", options.segment)

    const { data, error } = await query
    if (error) {
      await logServerError({
        message: "Kunne ikke hente godkjenningskøen",
        error,
        level: "warning",
        source: "server",
      })
      return []
    }

    const rows = (data ?? []) as RawRow[]
    const researchIds = rows
      .map((row) => row.research_id)
      .filter((id): id is string => typeof id === "string")

    const dossiers = new Map<string, ApprovalDossier>()
    if (researchIds.length > 0) {
      const { data: researchRows } = await admin
        .from("prospect_research")
        .select(
          "id, summary, best_angle, pains, disqualifiers, hooks, fit, sources, verdict, facts, cost_usd, created_at",
        )
        .in("id", researchIds)

      for (const row of (researchRows ?? []) as RawRow[]) {
        const mapped = mapDossier(row)
        if (mapped) dossiers.set(mapped.id, mapped)
      }
    }

    // Analysene bak de varme utkastene — jobben, summen og samtykket. Den som
    // bar samtykket fra samtykkeadressen først (samme regel som skriveren,
    // loadWarmFacts), ellers den siste analysen på leadet.
    const warmProspects = rows.filter((row) => row.kind === "varm").map((row) => asRecord(row.prospects))
    const analyseIds = warmProspects
      .map((prospect) => prospect.analyse_lead_id)
      .filter((id): id is string => typeof id === "string")
    const consentEmails = warmProspects
      .map((prospect) => (typeof prospect.consent_email === "string" ? prospect.consent_email.toLowerCase() : null))
      .filter((email): email is string => Boolean(email))

    const analyses = new Map<string, AnalyseFacts>()
    const consented = new Map<string, AnalyseFacts>()
    if (analyseIds.length > 0) {
      const { data: analyseRows } = await admin
        .from("analyse_leads")
        .select(ANALYSE_FACT_COLUMNS)
        .in("id", analyseIds)
      for (const analyseRow of (analyseRows ?? []) as AnalyseLeadRecord[]) {
        analyses.set(analyseRow.id, analyseFactsFrom(analyseRow))
      }
    }
    if (consentEmails.length > 0) {
      const { data: consentRows } = await admin
        .from("analyse_leads")
        .select(ANALYSE_FACT_COLUMNS)
        .in("email", consentEmails)
        .eq("follow_up_consent", true)
        .order("submitted_at", { ascending: false, nullsFirst: false })
      for (const analyseRow of (consentRows ?? []) as AnalyseLeadRecord[]) {
        const email = analyseRow.email.toLowerCase()
        if (!consented.has(email)) consented.set(email, analyseFactsFrom(analyseRow))
      }
    }

    const items: ApprovalItem[] = rows.map((row) => {
      const prospect = asRecord(row.prospects)
      const lint = asRecord(row.lint)
      const trade = (prospect.trade as string | null) ?? null
      const kind = String(row.kind ?? "kald")

      return {
        message: {
          id: String(row.id),
          step: Number(row.step ?? 1),
          kind,
          subject: String(row.subject ?? ""),
          body: String((row.body_final as string) || (row.body_ai as string) || ""),
          body_ai: String(row.body_ai ?? ""),
          angle: (row.angle as string) ?? null,
          hook_id: (row.hook_id as string) ?? null,
          grade: row.grade === null || row.grade === undefined ? null : Number(row.grade),
          grade_report: (row.grade_report as ApprovalItem["message"]["grade_report"]) ?? null,
          lint_issues: Array.isArray(lint.issues) ? (lint.issues as LintIssue[]) : [],
          expires_at: (row.expires_at as string) ?? null,
          created_at: String(row.created_at),
        },
        prospect: {
          id: String(prospect.id),
          name: String(prospect.name ?? ""),
          org_number: (prospect.org_number as string) ?? null,
          email: (prospect.email as string) ?? null,
          website: (prospect.website as string) ?? null,
          city: (prospect.city as string) ?? null,
          kommune: (prospect.kommune as string) ?? null,
          employee_count: (prospect.employee_count as number) ?? null,
          segment: String(prospect.segment ?? "handverker"),
          trade,
          trade_label: TRADE_LABELS[(trade ?? "annet") as TradeKey] ?? "Annet",
          fit_score: (prospect.fit_score as number) ?? null,
          fit_tier: (prospect.fit_tier as string) ?? null,
          contact_policy: (prospect.contact_policy as string) ?? null,
          email_kind: (prospect.email_kind as string) ?? null,
          consent_email: (prospect.consent_email as string) ?? null,
        },
        dossier: typeof row.research_id === "string" ? dossiers.get(row.research_id) ?? null : null,
        analyse:
          kind === "varm"
            ? (typeof prospect.consent_email === "string"
                ? consented.get(prospect.consent_email.toLowerCase())
                : undefined) ??
              (typeof prospect.analyse_lead_id === "string" ? analyses.get(prospect.analyse_lead_id) : undefined) ??
              null
            : null,
      }
    })

    // Varme først — de har selv bedt om det, og de blir kalde av å vente.
    // Deretter beste fit først; uten score havner de nederst.
    return items.sort((a, b) => {
      const warm = Number(b.message.kind === "varm") - Number(a.message.kind === "varm")
      return warm !== 0 ? warm : (b.prospect.fit_score ?? 0) - (a.prospect.fit_score ?? 0)
    })
  } catch (error) {
    await logServerError({
      message: "Godkjenningskøen feilet",
      error,
      level: "warning",
      source: "server",
    })
    return []
  }
}

export type MachineFunnel = {
  kilde: number
  venter_research: number
  kvalifisert: number
  til_godkjenning: number
  i_sekvens: number
  avsluttet: number
  for_tynn: number
  kun_telefon: number
  diskvalifisert: number
}

/** Traktstripen: hvor mange prospekter står på hvert maskinsteg akkurat nå. */
export async function fetchMachineFunnel(segment?: string | null): Promise<MachineFunnel> {
  const empty: MachineFunnel = {
    kilde: 0,
    venter_research: 0,
    kvalifisert: 0,
    til_godkjenning: 0,
    i_sekvens: 0,
    avsluttet: 0,
    for_tynn: 0,
    kun_telefon: 0,
    diskvalifisert: 0,
  }

  try {
    const admin = createAdminClient()
    let query = admin.from("prospects").select("pipeline_state")
    if (segment) query = query.eq("segment", segment)

    const { data, error } = await query
    if (error || !data) return empty

    for (const row of data as Array<{ pipeline_state: string | null }>) {
      const state = row.pipeline_state
      if (state && state in empty) empty[state as keyof MachineFunnel] += 1
    }
    return empty
  } catch {
    return empty
  }
}

/** Siste dossier for ett prospekt, til lead-kortet. */
export async function fetchProspectDossier(prospectId: string): Promise<ApprovalDossier | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("prospect_research")
      .select(
        "id, summary, best_angle, pains, disqualifiers, hooks, fit, sources, verdict, facts, cost_usd, created_at",
      )
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) return null
    return mapDossier(data as RawRow)
  } catch {
    return null
  }
}
