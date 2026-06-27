// Deterministic lead scoring — NO LLM, so it can run on every webhook event.
//
// A 0-100 score combining FIT (who they are) and INTENT (how they've engaged).
// The seller's whole cockpit ranks on this, and `is_hot` drives the hot-feed.
// Cheap, explainable math; the LLM is reserved for narrative surfaces (call-brief,
// standup, redraft).

import { resolveBransje } from "@/lib/outreach/bransje"

export type HeatLevel = "hot" | "warm" | "cold"

export type LeadScoreInput = {
  naceCode?: string | null
  naceDescription?: string | null
  employeeCount?: number | null
  email?: string | null
  status?: string | null
  openCount?: number | null
  clickCount?: number | null
  lastContactedAt?: string | null
}

export type LeadScore = { score: number; reasons: string[] }

const DAY_MS = 24 * 60 * 60 * 1000

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/** A prospect is "hot" the moment they show buying intent: a click, repeated opens,
 *  or a manual status that means they've replied / booked a demo. */
export function classifyHot(
  openCount?: number | null,
  clickCount?: number | null,
  status?: string | null
): boolean {
  if ((clickCount ?? 0) >= 1) return true
  if ((openCount ?? 0) >= 2) return true
  if (status === "svar" || status === "demo") return true
  return false
}

/** Coarse heat bucket used for badges and ordering. */
export function heatForProspect(input: LeadScoreInput): HeatLevel {
  if (classifyHot(input.openCount, input.clickCount, input.status)) return "hot"
  if ((input.openCount ?? 0) >= 1 || input.status === "kontaktet") return "warm"
  return "cold"
}

export function computeLeadScore(input: LeadScoreInput): LeadScore {
  const reasons: string[] = []
  let score = 0

  // --- FIT (max ~30) ---
  if (input.email) {
    score += 10
    reasons.push("Har e-post")
  }

  const employees = input.employeeCount ?? 0
  if (employees >= 3 && employees <= 50) {
    score += 15
    reasons.push("God størrelse (3–50 ansatte)")
  } else if (employees > 50) {
    score += 6
    reasons.push("Stor bedrift")
  } else if (employees >= 1) {
    score += 6
    reasons.push("Liten bedrift")
  }

  const bransje = resolveBransje({ naceCode: input.naceCode, naceDescription: input.naceDescription })
  if (bransje !== "bygg") {
    score += 5
    reasons.push("Tydelig fagbransje")
  }

  // --- INTENT (up to 104: opens 24 + clicks 40 + status 40) — engagement
  //     dominates and can saturate the 0-100 clamp on its own; that's the buying signal ---
  const opens = input.openCount ?? 0
  const clicks = input.clickCount ?? 0
  if (opens > 0) {
    const pts = clamp(opens * 8, 0, 24)
    score += pts
    reasons.push(`Åpnet ${opens} ${opens === 1 ? "gang" : "ganger"}`)
  }
  if (clicks > 0) {
    const pts = clamp(clicks * 20, 0, 40)
    score += pts
    reasons.push(`Klikket ${clicks} ${clicks === 1 ? "gang" : "ganger"}`)
  }

  switch (input.status) {
    case "svar":
      score += 30
      reasons.push("Har svart")
      break
    case "demo":
      score += 40
      reasons.push("Demo avtalt")
      break
    case "kontaktet":
      score += 5
      reasons.push("Kontaktet")
      break
    default:
      break
  }

  // --- RECENCY — recent engagement is worth more ---
  if (input.lastContactedAt) {
    const ageDays = (Date.now() - new Date(input.lastContactedAt).getTime()) / DAY_MS
    if (ageDays <= 3) {
      score += 5
      reasons.push("Nylig aktivitet")
    } else if (ageDays > 21) {
      score -= 5
      reasons.push("Kaldt en stund")
    }
  }

  return { score: clamp(Math.round(score), 0, 100), reasons }
}
