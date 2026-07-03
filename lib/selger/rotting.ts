// «Råtner»-varsler (Pipedrive-inspirert): et lead som har ligget for lenge uten
// aktivitet i et åpent steg flagges visuelt. Beregnes ALLTID fra
// prospects.last_activity_at — aldri lagret (derived data råtner selv).

import type { ProspectStatus } from "@/lib/outreach/types"

/** Dager uten aktivitet før et lead regnes som råtnende, per steg.
 *  Steg uten terskel (ny/kunde/tapt) råtner aldri. */
export const ROTTING_THRESHOLD_DAYS: Partial<Record<ProspectStatus, number>> = {
  kvalifisert: 7,
  kontaktet: 5,
  dialog: 4,
  demo: 7,
  trial: 5,
}

export type RottingLevel = "fresh" | "rotting" | "rotten"

export type Rotting = {
  /** Hele dager siden siste aktivitet. */
  days: number
  level: RottingLevel
}

const DAY_MS = 24 * 60 * 60 * 1000

export function daysSince(iso: string | null | undefined): number {
  if (!iso) return 0
  const diff = Date.now() - new Date(iso).getTime()
  return Math.max(0, Math.floor(diff / DAY_MS))
}

/** Råtne-status for et lead: `rotting` ved terskelen, `rotten` ved 2×. */
export function rottingFor(
  status: ProspectStatus,
  lastActivityAt: string | null | undefined
): Rotting {
  const days = daysSince(lastActivityAt)
  const threshold = ROTTING_THRESHOLD_DAYS[status]
  if (!threshold) return { days, level: "fresh" }
  if (days >= threshold * 2) return { days, level: "rotten" }
  if (days >= threshold) return { days, level: "rotting" }
  return { days, level: "fresh" }
}
