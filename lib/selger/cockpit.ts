// Data til cockpiten på «I dag».
//
// Rekkefølgen på skjermen er en påstand om hva som er viktigst, og den er:
//
//   1. Svar som venter      — noen har rakt opp hånda. Alt annet kan vente.
//   2. Utkast til godkjenning — 15 minutter som holder maskinen i gang.
//   3. Varme signaler        — klikk, analyser og aktive prøvebrukere.
//
// Maskinrom-stripen nederst er ikke en oppgave. Den er der for at Casper skal
// kunne se om maskinen faktisk jobber, uten å måtte spørre noen.

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { checkHealth, type HealthReport } from "@/lib/outreach/health"
import { countOutreachSentToday, getOutreachDailyLimit, startOfOsloDayIso } from "@/lib/outreach/send"
import { loadSettings } from "@/lib/outreach/settings"
import { REPLY_CLASS_LABELS, type ReplyClass } from "@/lib/outreach/inbox/classify"
import { fetchActivation } from "@/lib/selger/aktivering"

export type PendingReply = {
  id: string
  prospectId: string | null
  prospectName: string
  fromEmail: string
  subject: string | null
  preview: string
  classification: ReplyClass | null
  classificationLabel: string
  suggestedReply: string | null
  receivedAt: string
  matchMethod: string | null
}

export type WarmSignal = {
  id: string
  prospectId: string
  name: string
  reason: string
  detail: string
  at: string | null
}

export type MachineRoom = {
  /** Siden midnatt i går, norsk tid. */
  funnet: number
  researchet: number
  kvalifisert: number
  utkast: number
  sendt: number
  svar: number
  /** Kostnad for dossierene i samme periode. */
  cost_usd: number
}

export type CockpitData = {
  replies: PendingReply[]
  approvalCount: number
  warmSignals: WarmSignal[]
  machine: MachineRoom
  health: HealthReport
  quota: { brukt: number; tak: number }
  paused: boolean
  pauseReason: string | null
  /** Sist gang ticken faktisk leste innboksen. */
  lastInboxRun: string | null
}

const EMPTY_MACHINE: MachineRoom = {
  funnet: 0,
  researchet: 0,
  kvalifisert: 0,
  utkast: 0,
  sendt: 0,
  svar: 0,
  cost_usd: 0,
}

/** Midnatt i går, norsk tid — «siden i går» i maskinrom-stripen. */
function sinceYesterday(): string {
  const todayStart = new Date(startOfOsloDayIso())
  return new Date(todayStart.getTime() - 24 * 60 * 60 * 1000).toISOString()
}

function preview(text: string | null): string {
  const clean = (text || "").replace(/\s+/g, " ").trim()
  return clean.length > 220 ? `${clean.slice(0, 217)}…` : clean
}

export async function fetchCockpitData(): Promise<CockpitData> {
  const admin = createAdminClient()
  const since = sinceYesterday()

  const fallback: CockpitData = {
    replies: [],
    approvalCount: 0,
    warmSignals: [],
    machine: EMPTY_MACHINE,
    health: {
      sampled: 0,
      delivered: 0,
      bounced: 0,
      complained: 0,
      bounce_rate: 0,
      complaint_rate: 0,
      healthy: true,
      pause_reason: null,
      paused_now: false,
    },
    quota: { brukt: 0, tak: getOutreachDailyLimit() },
    paused: true,
    pauseReason: null,
    lastInboxRun: null,
  }

  try {
    const [
      repliesRes,
      approvalRes,
      warmRes,
      foundRes,
      researchRes,
      draftRes,
      sentRes,
      replyCountRes,
      settings,
      health,
      sentToday,
      cursorRes,
    ] = await Promise.all([
      // Ubehandlede svar, nyeste først.
      admin
        .from("inbound_emails")
        .select(
          "id, prospect_id, from_email, subject, text_body, classification, suggested_reply, received_at, match_method, prospects(name)",
        )
        .is("handled_at", null)
        .not("classification", "is", null)
        .order("received_at", { ascending: false })
        .limit(20),

      admin
        .from("outreach_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "til_godkjenning"),

      // Varme: klikket, eller merket hot, og ikke allerede i dialog.
      admin
        .from("prospects")
        .select("id, name, click_count, hot_since, last_activity_at, status, source")
        .eq("is_hot", true)
        .in("status", ["kvalifisert", "kontaktet", "trial"])
        .order("hot_since", { ascending: false, nullsFirst: false })
        .limit(12),

      admin
        .from("prospects")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),

      admin
        .from("prospect_research")
        .select("verdict, cost_usd")
        .gte("created_at", since)
        .limit(500),

      admin
        .from("outreach_messages")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),

      admin
        .from("outreach_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "sendt")
        .gte("sent_at", since),

      admin
        .from("inbound_emails")
        .select("id", { count: "exact", head: true })
        .gte("received_at", since),

      loadSettings(),
      checkHealth({ dryRun: true }),
      countOutreachSentToday(admin),
      admin
        .from("selger_inbox_cursor")
        .select("last_run_at")
        .eq("mailbox", "INBOX")
        .maybeSingle<{ last_run_at: string | null }>(),
    ])

    // Prøvebrukere er det varmeste vi har: de har allerede sagt ja til å
    // prøve. Aktiveringen sier hvem som trenger en telefon, og hvorfor.
    const { data: trialRows } = await admin
      .from("prospects")
      .select("id, name, matched_company_id, last_activity_at")
      .eq("status", "trial")
      .not("matched_company_id", "is", null)
      .limit(30)

    const trials = (trialRows ?? []) as Array<{
      id: string
      name: string
      matched_company_id: string
      last_activity_at: string | null
    }>
    const activation = await fetchActivation(trials.map((row) => row.matched_company_id))

    const replies: PendingReply[] = (repliesRes.data ?? []).map((row) => {
      const record = row as Record<string, unknown>
      const prospect = Array.isArray(record.prospects) ? record.prospects[0] : record.prospects
      const klasse = (record.classification as ReplyClass | null) ?? null
      return {
        id: String(record.id),
        prospectId: (record.prospect_id as string) ?? null,
        prospectName: ((prospect as { name?: string } | null)?.name ?? "Ukjent firma") as string,
        fromEmail: String(record.from_email ?? ""),
        subject: (record.subject as string) ?? null,
        preview: preview(record.text_body as string | null),
        classification: klasse,
        classificationLabel: klasse ? REPLY_CLASS_LABELS[klasse] : "Uklart",
        suggestedReply: (record.suggested_reply as string) ?? null,
        receivedAt: String(record.received_at),
        matchMethod: (record.match_method as string) ?? null,
      }
    })

    const warmSignals: WarmSignal[] = ((warmRes.data ?? []) as unknown[]).map((row) => {
      const record = row as Record<string, unknown>
      const clicks = Number(record.click_count ?? 0)
      const fromAnalyse = record.source === "analyse"
      return {
        id: `warm-${record.id}`,
        prospectId: String(record.id),
        name: String(record.name ?? ""),
        reason: fromAnalyse ? "Kjørte analyse" : clicks > 0 ? "Klikket på lenken" : "Varmt lead",
        detail: fromAnalyse
          ? "Kom inn via analysen på proanbud.no"
          : clicks > 0
            ? `${clicks} klikk`
            : "Merket som varm",
        at: (record.hot_since as string) ?? (record.last_activity_at as string) ?? null,
      }
    })

    // Prøvesignalene først: de er nærmere penger enn et klikk.
    // Sorteringen løfter to grupper: de som brenner (høy aktivering), og de
    // som er i ferd med å ryke (ikke innlogget). Begge trenger en telefon i
    // dag — de midt imellom kan vente.
    const trialPriority = (percent: number, daysSinceSeen: number | null) =>
      percent >= 60 ? 0 : daysSinceSeen === null || daysSinceSeen >= 3 ? 1 : 2

    const trialSignals: WarmSignal[] = trials
      .flatMap((row) => {
        const score = activation.get(row.matched_company_id)
        if (!score) return []
        return [
          {
            signal: {
              id: `trial-${row.id}`,
              prospectId: row.id,
              name: row.name,
              reason: "Prøvebruker",
              detail: `${score.percent} % aktivert — ${score.nextMove}`,
              at: row.last_activity_at,
            } satisfies WarmSignal,
            priority: trialPriority(score.percent, score.daysSinceSeen),
          },
        ]
      })
      .sort((a, b) => a.priority - b.priority)
      .map((entry) => entry.signal)

    warmSignals.unshift(...trialSignals)

    const researchRows = (researchRes.data ?? []) as Array<{
      verdict: string
      cost_usd: number | null
    }>

    const machine: MachineRoom = {
      funnet: foundRes.count ?? 0,
      researchet: researchRows.length,
      kvalifisert: researchRows.filter((row) => row.verdict === "kvalifisert").length,
      utkast: draftRes.count ?? 0,
      sendt: sentRes.count ?? 0,
      svar: replyCountRes.count ?? 0,
      cost_usd: researchRows.reduce((sum, row) => sum + Number(row.cost_usd ?? 0), 0),
    }

    return {
      replies,
      approvalCount: approvalRes.count ?? 0,
      warmSignals,
      machine,
      health,
      quota: {
        brukt: sentToday,
        tak: Math.min(getOutreachDailyLimit(), settings.daily_cap),
      },
      paused: settings.paused,
      pauseReason: settings.pause_reason,
      lastInboxRun: cursorRes.data?.last_run_at ?? null,
    }
  } catch (error) {
    // Cockpiten skal aldri velte «I dag». Mangler db/91–92, viser den bare
    // ingenting, og resten av siden virker som før.
    await logServerError({
      message: "Kunne ikke hente cockpit-data",
      error,
      level: "warning",
      source: "server",
    })
    return fallback
  }
}

/** Innkommende svar for ett lead, nyeste først. Til tidslinjen på lead-kortet. */
export async function fetchProspectReplies(prospectId: string): Promise<PendingReply[]> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("inbound_emails")
      .select(
        "id, prospect_id, from_email, subject, text_body, classification, suggested_reply, received_at, match_method, handled_at",
      )
      .eq("prospect_id", prospectId)
      .order("received_at", { ascending: false })
      .limit(20)

    if (error || !data) return []

    return data.map((row) => {
      const record = row as Record<string, unknown>
      const klasse = (record.classification as ReplyClass | null) ?? null
      return {
        id: String(record.id),
        prospectId: (record.prospect_id as string) ?? null,
        prospectName: "",
        fromEmail: String(record.from_email ?? ""),
        subject: (record.subject as string) ?? null,
        preview: preview(record.text_body as string | null),
        classification: klasse,
        classificationLabel: klasse ? REPLY_CLASS_LABELS[klasse] : "Sendt av Casper",
        suggestedReply: (record.suggested_reply as string) ?? null,
        receivedAt: String(record.received_at),
        matchMethod: (record.match_method as string) ?? null,
      }
    })
  } catch {
    return []
  }
}

export type UnmatchedReply = PendingReply & { handled: boolean }

/**
 * Svar maskinen ikke klarte å koble, pluss alt ubehandlet.
 *
 * Et svar uten treff er ikke et problem maskinen skal løse med gjetning — det
 * er ett klikk for Casper, og så vet den det neste gang.
 */
export async function fetchReplyInbox(): Promise<{
  unmatched: UnmatchedReply[]
  unhandled: UnmatchedReply[]
}> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("inbound_emails")
      .select(
        "id, prospect_id, from_email, subject, text_body, classification, suggested_reply, received_at, match_method, handled_at, prospects(name)",
      )
      .order("received_at", { ascending: false })
      .limit(100)

    if (error || !data) return { unmatched: [], unhandled: [] }

    const rows: UnmatchedReply[] = data.map((row) => {
      const record = row as Record<string, unknown>
      const prospect = Array.isArray(record.prospects) ? record.prospects[0] : record.prospects
      const klasse = (record.classification as ReplyClass | null) ?? null
      return {
        id: String(record.id),
        prospectId: (record.prospect_id as string) ?? null,
        prospectName: ((prospect as { name?: string } | null)?.name ?? "Ukoblet") as string,
        fromEmail: String(record.from_email ?? ""),
        subject: (record.subject as string) ?? null,
        preview: preview(record.text_body as string | null),
        classification: klasse,
        classificationLabel: klasse ? REPLY_CLASS_LABELS[klasse] : "Uklart",
        suggestedReply: (record.suggested_reply as string) ?? null,
        receivedAt: String(record.received_at),
        matchMethod: (record.match_method as string) ?? null,
        handled: Boolean(record.handled_at),
      }
    })

    return {
      unmatched: rows.filter((row) => !row.prospectId),
      unhandled: rows.filter((row) => row.prospectId && !row.handled),
    }
  } catch {
    return { unmatched: [], unhandled: [] }
  }
}
