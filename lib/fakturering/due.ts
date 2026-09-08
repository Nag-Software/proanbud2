/**
 * Forfall på en faktura.
 *
 * Fiken eier fakturaen, men vi kjenner utsendelsesdato og betalingsfrist, så forfallet
 * kan regnes ut her. Én felles beregning for både lista og dashbordet — ellers ville de
 * to kunne si forskjellige ting om samme faktura.
 *
 * MERK skillet mellom å VISE og å MASE:
 *   - Lista viser «Forfalt» fra og med dagen etter fristen. Det er et faktum.
 *   - Dashbordet venter noen dager før det varsler (OVERDUE_GRACE_DAYS), fordi
 *     betalinger bruker et par dager på å registreres og fordi vi henter
 *     betalingsstatus fra Fiken bare én gang i døgnet.
 * Samme tall, ulik terskel — det er bevisst.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export const DEFAULT_DUE_DAYS = 14

export type InvoiceDueInput = {
  status: string
  sentAt: string | null
  dueDays: number | null
  paidAt: string | null
}

export type InvoiceDueState = {
  /** Når fakturaen forfaller. Null når den ikke er sendt. */
  dueAt: Date | null
  /** Positivt = dager over fristen. Negativt = dager igjen. Null når ukjent. */
  daysOverdue: number | null
  /** Sendt, ubetalt og over fristen. */
  isOverdue: boolean
}

export function computeInvoiceDueState(
  invoice: InvoiceDueInput,
  now: number = Date.now()
): InvoiceDueState {
  // Betalt eller kansellert kan ikke forfalle.
  if (invoice.paidAt || invoice.status === "paid" || invoice.status === "cancelled") {
    return { dueAt: null, daysOverdue: null, isOverdue: false }
  }
  if (!invoice.sentAt) {
    return { dueAt: null, daysOverdue: null, isOverdue: false }
  }

  const sentAt = new Date(invoice.sentAt).getTime()
  if (Number.isNaN(sentAt)) {
    return { dueAt: null, daysOverdue: null, isOverdue: false }
  }

  const dueMs = sentAt + Number(invoice.dueDays ?? DEFAULT_DUE_DAYS) * DAY_MS
  const daysOverdue = Math.floor((now - dueMs) / DAY_MS)

  return {
    dueAt: new Date(dueMs),
    daysOverdue,
    isOverdue: daysOverdue > 0,
  }
}

/** «forfalt for 6 dager siden» / «forfaller om 3 dager» / «forfaller i dag». */
export function describeInvoiceDue(state: InvoiceDueState): string | null {
  if (state.daysOverdue === null) return null
  const d = state.daysOverdue
  if (d > 0) return `forfalt for ${d} ${d === 1 ? "dag" : "dager"} siden`
  if (d === 0) return "forfaller i dag"
  const left = Math.abs(d)
  return `forfaller om ${left} ${left === 1 ? "dag" : "dager"}`
}
