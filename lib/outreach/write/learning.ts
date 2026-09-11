// Læringsminnet.
//
// Caspers redigeringer er det mest verdifulle treningssignalet vi har, og de
// er gratis — han gjør dem uansett. Derfor lagres KI-originalen og den
// endelige teksten side om side fra første utkast (db/91), og de siste
// godkjente e-postene i samme segment legges inn i neste prompt.
//
// Dette er ikke finjustering. Det er å vise skriveren hva som faktisk ble sendt.

import { createAdminClient } from "@/lib/supabase/admin"

export const REJECT_REASONS = [
  "generisk",
  "feil_fakta",
  "feil_tone",
  "feil_vinkel",
  "for_lang",
  "feil_maalgruppe",
] as const

export type RejectReason = (typeof REJECT_REASONS)[number]

export const REJECT_REASON_LABELS: Record<RejectReason, string> = {
  generisk: "For generisk",
  feil_fakta: "Feil fakta",
  feil_tone: "Feil tone",
  feil_vinkel: "Feil vinkel",
  for_lang: "For lang",
  feil_maalgruppe: "Feil målgruppe",
}

export function isRejectReason(value: unknown): value is RejectReason {
  return typeof value === "string" && (REJECT_REASONS as readonly string[]).includes(value)
}

export type LearningMemory = {
  /** De siste godkjente e-postene, slik de faktisk ble sendt. */
  approved: Array<{ subject: string; body: string; edited: boolean }>
  /** De vanligste avvisningsgrunnene, med antall. */
  rejections: Array<{ reason: RejectReason; count: number; note: string | null }>
  /** Andel avviste av de siste 50 — styrer om fase 2 kan skrus på. */
  reject_rate: number | null
}

type MessageRow = {
  subject: string
  body_ai: string
  body_final: string | null
  status: string
  reject_reason: string | null
  reject_note: string | null
}

/**
 * Henter læringsminnet for et segment. Feiler oppslaget, får vi et tomt minne
 * — skriveren skal fungere også første gang, før det finnes historikk.
 */
export async function loadLearningMemory(segment: string): Promise<LearningMemory> {
  const empty: LearningMemory = { approved: [], rejections: [], reject_rate: null }

  try {
    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("outreach_messages")
      .select("subject, body_ai, body_final, status, reject_reason, reject_note, prospects!inner(segment)")
      .eq("prospects.segment", segment)
      .eq("step", 1)
      .in("status", ["godkjent", "planlagt", "sendt", "avvist"])
      .order("created_at", { ascending: false })
      .limit(50)

    if (error || !data) return empty

    const rows = data as unknown as MessageRow[]

    const approved = rows
      .filter((row) => row.status !== "avvist")
      .slice(0, 5)
      .map((row) => ({
        subject: row.subject,
        body: row.body_final || row.body_ai,
        edited: Boolean(row.body_final && row.body_final !== row.body_ai),
      }))

    const counts = new Map<RejectReason, { count: number; note: string | null }>()
    for (const row of rows) {
      if (row.status !== "avvist" || !isRejectReason(row.reject_reason)) continue
      const current = counts.get(row.reject_reason) ?? { count: 0, note: null }
      counts.set(row.reject_reason, {
        count: current.count + 1,
        note: current.note ?? row.reject_note,
      })
    }

    const rejections = [...counts.entries()]
      .map(([reason, value]) => ({ reason, count: value.count, note: value.note }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)

    const rejected = rows.filter((row) => row.status === "avvist").length
    const rejectRate = rows.length >= 10 ? rejected / rows.length : null

    return { approved, rejections, reject_rate: rejectRate }
  } catch {
    return empty
  }
}

/** Læringsminnet som prompt-tekst. Tom streng når vi ikke har noe å vise. */
export function memoryForPrompt(memory: LearningMemory): string {
  const parts: string[] = []

  if (memory.approved.length > 0) {
    parts.push(
      "Slik så de siste e-postene Casper faktisk godkjente ut. Skriv i samme stemme, men aldri samme innhold:",
      ...memory.approved.map(
        (message, index) =>
          `\n[${index + 1}${message.edited ? ", redigert av Casper" : ""}] Emne: ${message.subject}\n${message.body}`,
      ),
    )
  }

  if (memory.rejections.length > 0) {
    parts.push(
      "",
      "Dette har Casper avvist utkast for i det siste — unngå det:",
      ...memory.rejections.map(
        (rejection) =>
          `- ${REJECT_REASON_LABELS[rejection.reason]} (${rejection.count} ganger)${
            rejection.note ? `: «${rejection.note}»` : ""
          }`,
      ),
    )
  }

  return parts.join("\n")
}

/**
 * Hvor mye Casper endret utkastet, 0–1. Normalisert Levenshtein på ord.
 * Brukes til å se om autopilot er fortjent (median under 15 %).
 */
export function editRatio(original: string, final: string): number {
  const a = original.trim().split(/\s+/).filter(Boolean)
  const b = final.trim().split(/\s+/).filter(Boolean)
  if (a.length === 0 && b.length === 0) return 0
  if (a.length === 0 || b.length === 0) return 1

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }

  return Math.min(1, previous[b.length] / Math.max(a.length, b.length))
}
