// Små dato-hjelpere for salgs-UI-et (kort, oppgaverader, record-siden).

const DAY_MS = 24 * 60 * 60 * 1000

/** Hele dager leadet har ligget i nåværende steg. */
export function daysInStage(stageEnteredAt: string | null): number {
  if (!stageEnteredAt) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(stageEnteredAt).getTime()) / DAY_MS))
}

/** Dager igjen av trial (negativt = utløpt), null uten sluttdato. */
export function trialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null
  return Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / DAY_MS)
}

/** Menneskelig forfallstekst for en oppgave: «2 d forfalt» / «i dag» / «i morgen» / dato. */
export function dueLabel(dueAt: string): { text: string; overdue: boolean } {
  const due = new Date(dueAt)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayDiff = Math.floor((due.getTime() - startOfToday.getTime()) / DAY_MS)
  if (dayDiff < 0) return { text: `${-dayDiff} d forfalt`, overdue: true }
  if (dayDiff === 0) return { text: "i dag", overdue: false }
  if (dayDiff === 1) return { text: "i morgen", overdue: false }
  return {
    text: due.toLocaleDateString("no-NO", { day: "numeric", month: "short" }),
    overdue: false,
  }
}
