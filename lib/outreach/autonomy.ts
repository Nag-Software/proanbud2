// Autonomi per segment.
//
// Autopilot skal FORTJENES, ikke skrus på. Regelen er enkel og med vilje
// streng: 30 steg 1-utkast på rad med minst 90 % godkjent, median redigering
// under 15 %, og null avvisninger med grunnen «feil fakta». Én eneste
// faktafeil nullstiller telleren, fordi en maskin som finner på tall ikke skal
// få sende uten at noen leser.
//
// Nedgraderingen er automatisk og trenger ingen vurdering: bounce-topp, klage,
// avvisningsrate over 40 %, eller et negativt svar om tonen.
//
// Merk: LLM-sensoren brukes IKKE som port for autopilot ennå. Den skal først
// kalibreres mot Caspers egne ~150–200 avgjørelser, og de finnes ikke før
// godkjenningskøen har gått en stund.

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { evaluateHealth } from "@/lib/outreach/health-rules"
import { OUTREACH_TEMPLATE_IDS } from "@/lib/outreach/send"
import type { SegmentKey } from "@/lib/outreach/segments"
import type { ApprovalMode } from "@/lib/outreach/settings"

/** Hvor mange avgjørelser på rad som teller. */
export const AUTONOMY_WINDOW = 30
export const MIN_APPROVAL_RATE = 0.9
export const MAX_MEDIAN_EDIT = 0.15
/** Over denne avvisningsraten skrus autopilot ned igjen. */
export const DOWNGRADE_REJECT_RATE = 0.4
/** Fase 2 (autonom løkke) skal ikke skrus på før avvisningsraten er under dette. */
export const PHASE_TWO_REJECT_RATE = 0.3

export type AutonomyStats = {
  segment: SegmentKey
  /** Antall avgjørelser i vinduet. */
  decided: number
  approved: number
  rejected: number
  approval_rate: number
  reject_rate: number
  median_edit: number | null
  wrong_facts: number
  /** Er autopilot fortjent akkurat nå? */
  earned: boolean
  /** Hvorfor ikke, i klartekst. */
  blockers: string[]
  /** Grunn til at maskinen bør skrus NED. Null = ingen. */
  downgrade_reason: string | null
  current_mode: ApprovalMode
  /** Er avvisningsraten lav nok til at fase 2 kan slås på? */
  ready_for_auto_followups: boolean
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

type DecisionRow = {
  status: string
  reject_reason: string | null
  edit_ratio: number | null
}

/**
 * Regner ut autonomistatus for ett segment.
 *
 * Ren lesing — den endrer ingenting. Å faktisk skru opp eller ned er et eget
 * valg (`applyAutonomy`), slik at tallene kan vises i Analyse uten at det å se
 * på dem forandrer noe.
 */
export async function computeAutonomy(
  segment: SegmentKey,
  currentMode: ApprovalMode,
): Promise<AutonomyStats> {
  const empty: AutonomyStats = {
    segment,
    decided: 0,
    approved: 0,
    rejected: 0,
    approval_rate: 0,
    reject_rate: 0,
    median_edit: null,
    wrong_facts: 0,
    earned: false,
    blockers: ["Ingen avgjørelser ennå"],
    downgrade_reason: null,
    current_mode: currentMode,
    ready_for_auto_followups: false,
  }

  try {
    const admin = createAdminClient()

    const { data, error } = await admin
      .from("outreach_messages")
      .select("status, reject_reason, edit_ratio, prospects!inner(segment)")
      .eq("prospects.segment", segment)
      .eq("step", 1)
      .in("status", ["godkjent", "planlagt", "sendt", "avvist"])
      .order("approved_at", { ascending: false, nullsFirst: false })
      .limit(AUTONOMY_WINDOW)

    if (error || !data) return empty

    const rows = data as unknown as DecisionRow[]
    if (rows.length === 0) return empty

    const rejected = rows.filter((row) => row.status === "avvist").length
    const approved = rows.length - rejected
    const approvalRate = approved / rows.length
    const rejectRate = rejected / rows.length
    const wrongFacts = rows.filter((row) => row.reject_reason === "feil_fakta").length

    const edits = rows
      .filter((row) => row.status !== "avvist" && row.edit_ratio !== null)
      .map((row) => Number(row.edit_ratio))
    const medianEdit = median(edits)

    const blockers: string[] = []
    if (rows.length < AUTONOMY_WINDOW) {
      blockers.push(`${rows.length} av ${AUTONOMY_WINDOW} avgjørelser`)
    }
    if (approvalRate < MIN_APPROVAL_RATE) {
      blockers.push(`${Math.round(approvalRate * 100)} % godkjent, kravet er ${MIN_APPROVAL_RATE * 100} %`)
    }
    if (medianEdit !== null && medianEdit > MAX_MEDIAN_EDIT) {
      blockers.push(
        `median redigering ${Math.round(medianEdit * 100)} %, kravet er under ${MAX_MEDIAN_EDIT * 100} %`,
      )
    }
    if (wrongFacts > 0) {
      blockers.push(`${wrongFacts} avvist for feil fakta — telleren nullstilles`)
    }

    // ── Nedgradering ────────────────────────────────────────────────────────
    let downgrade: string | null = null
    if (rejectRate > DOWNGRADE_REJECT_RATE) {
      downgrade = `Avvisningsraten er ${Math.round(rejectRate * 100)} %`
    }

    const { data: logRows } = await admin
      .from("seller_email_log")
      .select("bounced_at, complained_at")
      .in("template_id", OUTREACH_TEMPLATE_IDS as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(50)

    const logs = (logRows ?? []) as Array<{ bounced_at: string | null; complained_at: string | null }>
    const health = evaluateHealth({
      sampled: logs.length,
      bounced: logs.filter((row) => row.bounced_at).length,
      complained: logs.filter((row) => row.complained_at).length,
    })
    if (!health.healthy) {
      downgrade = health.reason === "klage" ? "Spamklage registrert" : "For mange harde returer"
    }

    return {
      segment,
      decided: rows.length,
      approved,
      rejected,
      approval_rate: approvalRate,
      reject_rate: rejectRate,
      median_edit: medianEdit,
      wrong_facts: wrongFacts,
      earned: blockers.length === 0,
      blockers,
      downgrade_reason: downgrade,
      current_mode: currentMode,
      ready_for_auto_followups: rows.length >= 10 && rejectRate < PHASE_TWO_REJECT_RATE,
    }
  } catch (error) {
    void logServerError({
      message: "Kunne ikke regne ut autonomi",
      level: "warning",
      source: "worker",
      error,
      context: { segment },
    })
    return empty
  }
}

/**
 * Skrur ned autonomien når den ikke lenger er fortjent.
 *
 * Oppgradering skjer ALDRI automatisk — maskinen kan foreslå det, men Casper
 * må ta valget. Nedgradering skjer derimot uten å spørre: å vente på et svar
 * mens bouncene ruller inn er ikke en gyldig strategi.
 */
export async function enforceAutonomy(
  segment: SegmentKey,
  currentMode: ApprovalMode,
): Promise<{ changed: boolean; mode: ApprovalMode; reason: string | null }> {
  const stats = await computeAutonomy(segment, currentMode)

  if (currentMode === "alt_manuelt" || !stats.downgrade_reason) {
    return { changed: false, mode: currentMode, reason: stats.downgrade_reason }
  }

  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from("selger_settings")
      .select("approval_mode")
      .eq("id", "global")
      .maybeSingle<{ approval_mode: Record<string, ApprovalMode> }>()

    const modes = { ...(data?.approval_mode ?? {}), [segment]: "alt_manuelt" as ApprovalMode }
    await admin.from("selger_settings").update({ approval_mode: modes }).eq("id", "global")

    void logServerError({
      message: "Autonomi nedgradert automatisk",
      level: "warning",
      source: "worker",
      context: { segment, reason: stats.downgrade_reason },
    })

    return { changed: true, mode: "alt_manuelt", reason: stats.downgrade_reason }
  } catch {
    return { changed: false, mode: currentMode, reason: stats.downgrade_reason }
  }
}
