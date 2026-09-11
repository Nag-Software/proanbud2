// Ren regel for hvordan et koblet prospekt følger betalingsstatusen. Egen fil
// uten serveravhengigheter, så den kan enhetstestes (sync.ts drar inn server-only).

/** Betalingsstatuser der prøven er over uten at de ble kunde. */
const ENDED_BILLING_STATUSES = new Set(["canceled", "incomplete_expired", "unpaid"])

export type ProspectBillingTransition = {
  status: "trial" | "kunde" | "tapt"
  /** Logg som vunnet (won_prospect) / tapt (lost_prospect) i aktivitetsloggen. */
  outcome: "won" | "lost" | null
}

/**
 * Hvordan et KOBLET prospekt skal følge betalingen. null = ingen endring.
 *
 *  • betaler (active/past_due) → kunde, logges som vunnet — også fra «tapt»
 *    (de kom tilbake og kjøpte).
 *  • trialing → trial, men bare fra åpne steg (et vunnet lead ryker ikke tilbake).
 *  • prøven avsluttet uten kjøp (canceled/incomplete_expired/unpaid) → tapt,
 *    men bare fra «trial» — et lead Casper har flyttet selv røres ikke.
 */
export function reconcileProspectStatus(
  current: string,
  billingStatus: string,
): ProspectBillingTransition | null {
  if (billingStatus === "active" || billingStatus === "past_due") {
    return current === "kunde" ? null : { status: "kunde", outcome: "won" }
  }
  if (billingStatus === "trialing") {
    return current === "trial" || current === "kunde" || current === "tapt"
      ? null
      : { status: "trial", outcome: null }
  }
  if (ENDED_BILLING_STATUSES.has(billingStatus)) {
    return current === "trial" ? { status: "tapt", outcome: "lost" } : null
  }
  return null
}
