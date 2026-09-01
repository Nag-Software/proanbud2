/**
 * Rene klassifiseringsregler for Fiken-feil.
 *
 * Bor i egen modul fordi worker.ts drar inn server-only-moduler (Supabase-admin,
 * feillogging) og dermed ikke kan importeres i enhetstester. Disse to reglene avgjør om
 * en jobb dead-letter'es eller kan kjøres om igjen, så de fortjener direkte dekning.
 */

/**
 * Formen vi bryr oss om. Bevisst lokal i stedet for importert fra connector.ts —
 * den drar inn server-only-moduler, og da kan ikke disse rene reglene enhetstestes.
 */
type FikenErrorShape = { status?: number; body?: unknown }

function fikenErrorMessage(error: unknown): string {
  const body = (error as { body?: unknown })?.body
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>
    const candidate =
      (typeof record.message === "string" && record.message) ||
      (typeof record.error_description === "string" && record.error_description) ||
      (typeof record.error === "string" && record.error)
    if (candidate) {
      return candidate
    }
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * Var feilen TVETYDIG — altså kan Fiken ha rukket å opprette dokumentet?
 *
 * Bare da må vi dead-letter'e i stedet for å retrye (duplikat-risiko). En HTTP 4xx med
 * feilbody er en ren avvisning: Fiken validerte og sa nei, ingenting ble opprettet, og
 * jobben kan trygt kjøres om igjen. Å behandle alle finalize-feil som tvetydige gjorde
 * at vanlige valideringsfeil ble dead-letter'et som «ambiguous_create», noe som både er
 * feil og skremmende å lese i aktivitetsloggen.
 */
export function isAmbiguousFikenFailure(error: unknown): boolean {
  const status = (error as FikenErrorShape)?.status
  // Ingen status = nettverksfeil/timeout: vi vet ikke om requesten nådde fram.
  if (!status) return true
  // 5xx og 408 kan ha blitt utført på Fiken-siden før feilen oppsto.
  return status >= 500 || status === 408
}

/** Fiken mangler nummerserie for dokumenttypen — første dokument er aldri laget. */
export function isMissingNumberSeries(error: unknown): boolean {
  const message = fikenErrorMessage(error).toLowerCase()
  return (
    message.includes("missing number series") ||
    message.includes("counter not initialized") ||
    message.includes("number series")
  )
}

/**
 * Kladden mangler bankkonto — den ble laget FØR kontoen var valgt.
 *
 * Fiken lagrer `bankAccountNumber` PÅ kladden. Endrer vi hva vi sender, påvirker det
 * bare NYE kladder: en jobb som gjenopptar en gammel kladd sender aldri det nye feltet,
 * og feiler likt hver gang. Da må kladden kastes og lages på nytt.
 *
 * Skilles bevisst fra «kontonummer X er ikke bekreftet»: DET er Altinn-porten, og å lage
 * kladden på nytt hjelper ikke — det ville bare gitt en evig løkke.
 */
export function isDraftMissingBankAccount(error: unknown): boolean {
  const message = fikenErrorMessage(error).toLowerCase()
  return message.includes("bank account number null has not been verified")
}
