// Next-best-action rules — pure logic, no LLM. Given a prospect/company state,
// decide the ONE thing the seller should do, and how warm it is. The cockpit
// renders this as the card's primary verb.

import type { HeatLevel } from "@/lib/selger/scoring"
import { classifyHot } from "@/lib/selger/scoring"

export type NextAction = {
  /** Imperative verb shown on the card button, e.g. "Ring nå". */
  verb: string
  /** Short machine key for the action kind. */
  kind: "call" | "approve" | "followup" | "mark_customer" | "send_reminder" | "review"
  heat: HeatLevel
}

export type ProspectActionState = {
  status?: string | null
  email?: string | null
  phone?: string | null
  openCount?: number | null
  clickCount?: number | null
  lastContactedAt?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000

function daysSince(iso?: string | null): number {
  if (!iso) return Infinity
  return (Date.now() - new Date(iso).getTime()) / DAY_MS
}

/** What should the seller do with this prospect right now? */
export function nextActionForProspect(p: ProspectActionState): NextAction {
  const hot = classifyHot(p.openCount, p.clickCount, p.status)

  if (p.status === "demo") {
    return { verb: "Marker som kunde", kind: "mark_customer", heat: "hot" }
  }
  if (p.status === "svar") {
    return { verb: p.phone ? "Ring tilbake" : "Følg opp", kind: "call", heat: "hot" }
  }
  if (hot) {
    return { verb: p.phone ? "Ring nå" : "Følg opp", kind: "call", heat: "hot" }
  }
  // Cold-but-contacted and gone quiet for a while → a human nudge can help.
  if (p.status === "kontaktet" && daysSince(p.lastContactedAt) >= 5) {
    return { verb: p.phone ? "Ring" : "Følg opp", kind: "followup", heat: "warm" }
  }
  return { verb: p.phone ? "Ring" : "Følg opp", kind: "followup", heat: "warm" }
}

/** Trial company nudge, by how close the trial is to expiring. */
export function nextActionForTrial(daysLeft: number): NextAction {
  if (daysLeft <= 1) {
    return { verb: "Redd trial nå", kind: "call", heat: "hot" }
  }
  if (daysLeft <= 3) {
    return { verb: "Ring trial", kind: "call", heat: "warm" }
  }
  return { verb: "Følg opp trial", kind: "send_reminder", heat: "warm" }
}
