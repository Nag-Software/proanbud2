// Analyse av salgsmaskinen.
//
// Tallene her er valgt for å svare på fire spørsmål, i denne rekkefølgen:
//
//   1. Virker det?          trakt fra kilde til betalende
//   2. Hva virker best?     svarrate per vinkel, krok, fag og fylke
//   3. Skriver den bra?     godkjennings-, redigerings- og avvisningsrate
//   4. Hva koster det?      per kvalifisert lead og per svar
//
// Et tall uten et tilhørende valg er pynt. Hvert mål her peker på noe Casper
// faktisk kan gjøre: bytte vinkel, bytte fylke, stramme prompten, eller la
// være.

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { REJECT_REASON_LABELS, type RejectReason } from "@/lib/outreach/write/learning"
import { TRADE_LABELS, type TradeKey } from "@/lib/outreach/segments"

export type Breakdown = {
  key: string
  label: string
  sendt: number
  svar: number
  positive: number
  rate: number | null
}

export type WritingQuality = {
  decided: number
  approved: number
  rejected: number
  approval_rate: number | null
  /** Andel av godkjente som Casper endret i det hele tatt. */
  edited_share: number | null
  median_edit: number | null
  rejections: Array<{ reason: RejectReason; label: string; count: number }>
  /** Hvor ofte skriveren strøk på lint før den fikk til et utkast. */
  lint_fail_rate: number | null
}

export type Costs = {
  total_usd: number
  per_qualified: number | null
  per_reply: number | null
  per_sent: number | null
  research_runs: number
}

export type SalgsAnalyse = {
  breakdownByAngle: Breakdown[]
  breakdownByHook: Breakdown[]
  breakdownByTrade: Breakdown[]
  writing: WritingQuality
  costs: Costs
}

const EMPTY: SalgsAnalyse = {
  breakdownByAngle: [],
  breakdownByHook: [],
  breakdownByTrade: [],
  writing: {
    decided: 0,
    approved: 0,
    rejected: 0,
    approval_rate: null,
    edited_share: null,
    median_edit: null,
    rejections: [],
    lint_fail_rate: null,
  },
  costs: { total_usd: 0, per_qualified: null, per_reply: null, per_sent: null, research_runs: 0 },
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

/** Rater under dette antallet er støy, og vises som «for lite data». */
const MIN_FOR_RATE = 8

function toBreakdown(
  groups: Map<string, { sendt: number; svar: number; positive: number }>,
  label: (key: string) => string,
): Breakdown[] {
  return [...groups.entries()]
    .map(([key, value]) => ({
      key,
      label: label(key),
      sendt: value.sendt,
      svar: value.svar,
      positive: value.positive,
      rate: value.sendt >= MIN_FOR_RATE ? value.svar / value.sendt : null,
    }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.sendt - a.sendt)
}

export async function fetchSalgsAnalyse(): Promise<SalgsAnalyse> {
  try {
    const admin = createAdminClient()

    const [messagesRes, repliesRes, researchRes] = await Promise.all([
      admin
        .from("outreach_messages")
        .select(
          "id, prospect_id, step, status, angle, hook_id, edit_ratio, reject_reason, lint, prospects(trade)",
        )
        .limit(5000),
      admin
        .from("inbound_emails")
        .select("prospect_id, classification")
        .not("prospect_id", "is", null)
        .limit(5000),
      admin.from("prospect_research").select("verdict, cost_usd").limit(5000),
    ])

    const messages = (messagesRes.data ?? []) as Array<Record<string, unknown>>
    const replies = (repliesRes.data ?? []) as Array<{
      prospect_id: string
      classification: string | null
    }>
    const research = (researchRes.data ?? []) as Array<{
      verdict: string
      cost_usd: number | null
    }>

    // Hvem svarte, og var svaret positivt? Autosvar og returer teller ikke.
    const repliedProspects = new Set<string>()
    const positiveProspects = new Set<string>()
    for (const reply of replies) {
      if (reply.classification === "autosvar" || reply.classification === "ikke_levert") continue
      repliedProspects.add(reply.prospect_id)
      if (reply.classification === "positiv") positiveProspects.add(reply.prospect_id)
    }

    const byAngle = new Map<string, { sendt: number; svar: number; positive: number }>()
    const byHook = new Map<string, { sendt: number; svar: number; positive: number }>()
    const byTrade = new Map<string, { sendt: number; svar: number; positive: number }>()

    const bump = (
      map: Map<string, { sendt: number; svar: number; positive: number }>,
      key: string,
      prospectId: string,
    ) => {
      const current = map.get(key) ?? { sendt: 0, svar: 0, positive: 0 }
      current.sendt += 1
      if (repliedProspects.has(prospectId)) current.svar += 1
      if (positiveProspects.has(prospectId)) current.positive += 1
      map.set(key, current)
    }

    let sentCount = 0
    const edits: number[] = []
    let approved = 0
    let rejected = 0
    let editedCount = 0
    let lintFailed = 0
    const rejectionCounts = new Map<RejectReason, number>()

    for (const row of messages) {
      const status = String(row.status ?? "")
      const prospectId = String(row.prospect_id ?? "")

      if (status === "sendt") {
        sentCount += 1
        // Bare steg 1 grupperes på vinkel og krok — det er den meldingen som
        // faktisk bestemmer om noen svarer.
        if (Number(row.step ?? 1) === 1) {
          bump(byAngle, String(row.angle || "ukjent"), prospectId)
          bump(byHook, String(row.hook_id || "ukjent"), prospectId)
          const prospect = Array.isArray(row.prospects) ? row.prospects[0] : row.prospects
          const trade = ((prospect as { trade?: string } | null)?.trade ?? "annet") as string
          bump(byTrade, trade, prospectId)
        }
      }

      if (status === "avvist") {
        rejected += 1
        const reason = row.reject_reason as RejectReason | null
        if (reason) rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1)
      } else if (["godkjent", "planlagt", "sendt"].includes(status)) {
        approved += 1
        const ratio = row.edit_ratio === null ? null : Number(row.edit_ratio)
        if (ratio !== null) {
          edits.push(ratio)
          if (ratio > 0) editedCount += 1
        }
      }

      const lint = row.lint as { ok?: boolean } | null
      if (lint && lint.ok === false) lintFailed += 1
    }

    const decided = approved + rejected
    const qualified = research.filter((row) => row.verdict === "kvalifisert").length
    const totalCost = research.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0)
    const replyCount = repliedProspects.size

    return {
      breakdownByAngle: toBreakdown(byAngle, (key) => key),
      breakdownByHook: toBreakdown(byHook, (key) => key),
      breakdownByTrade: toBreakdown(
        byTrade,
        (key) => TRADE_LABELS[key as TradeKey] ?? key,
      ),
      writing: {
        decided,
        approved,
        rejected,
        approval_rate: decided >= MIN_FOR_RATE ? approved / decided : null,
        edited_share: approved > 0 ? editedCount / approved : null,
        median_edit: median(edits),
        rejections: [...rejectionCounts.entries()]
          .map(([reason, count]) => ({
            reason,
            label: REJECT_REASON_LABELS[reason] ?? reason,
            count,
          }))
          .sort((a, b) => b.count - a.count),
        lint_fail_rate: messages.length > 0 ? lintFailed / messages.length : null,
      },
      costs: {
        total_usd: totalCost,
        per_qualified: qualified > 0 ? totalCost / qualified : null,
        per_reply: replyCount > 0 ? totalCost / replyCount : null,
        per_sent: sentCount > 0 ? totalCost / sentCount : null,
        research_runs: research.length,
      },
    }
  } catch (error) {
    await logServerError({
      message: "Kunne ikke hente salgsanalyse",
      error,
      level: "warning",
      source: "server",
    })
    return EMPTY
  }
}
