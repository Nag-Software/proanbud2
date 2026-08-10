// Ren, testbar planlegger for aktiverings-/livssyklus-e-postene. Ingen I/O her —
// runneren (onboarding-emails.ts) henter data og kaller denne for å avgjøre hvilken
// e-post (om noen) som er forfalt for en bedrift akkurat nå.
//
// Dekker det trial-reminders.ts IKKE gjør: den tidlige aktiveringsfasen + win-back
// etter at prøven er utløpt (trial-reminders filtrerer på status='trialing' og ser
// derfor aldri en utløpt/kansellert prøve).

export const DAY_MS = 24 * 60 * 60 * 1000

export type LifecycleStage = "velkomst" | "aktivering" | "verdi" | "winback"

export type LifecycleInput = {
  now: number
  /** Når bedriften ble opprettet (registrering) i ms. */
  signupAtMs: number
  /** company_billing.status. */
  status: string
  /** trial_ends_at i ms, eller null. */
  trialEndsAtMs: number | null
  /** Har bedriften sendt minst ett tilbud? */
  hasSentOffer: boolean
  /** Har bedriften et betalende (aktivt) abonnement? */
  hasPaid: boolean
}

/**
 * Hvilken livssyklus-e-post er forfalt, om noen. Vinduene er disjunkte så bare én
 * treffer av gangen; idempotens (én utsending per mal per bedrift) håndteres av
 * runneren. Returnerer null når ingenting skal sendes.
 */
export function pickLifecycleEmail(input: LifecycleInput): LifecycleStage | null {
  const ageDays = (input.now - input.signupAtMs) / DAY_MS

  // Win-back: prøven er utløpt, de betalte aldri, og det er 5–12 dager siden.
  // Uavhengig av status (typisk 'canceled' etter kortfri utløp).
  if (!input.hasPaid && input.trialEndsAtMs != null) {
    const daysSinceExpiry = (input.now - input.trialEndsAtMs) / DAY_MS
    if (daysSinceExpiry >= 5 && daysSinceExpiry <= 12) return "winback"
  }

  // Tidlig fase gjelder bare mens de faktisk er i prøveperioden.
  if (input.status === "trialing") {
    if (ageDays < 2) return "velkomst"
    if (ageDays >= 3 && ageDays <= 6 && !input.hasSentOffer) return "aktivering"
    if (ageDays >= 10 && ageDays <= 20) return "verdi"
  }

  return null
}

/**
 * Firmanavn er fritekst ved registrering, og noen skriver inn e-postadressen sin
 * der. «Prøveperioden for ola@gmail.com er over» leser som en ødelagt flettefelt-
 * e-post. Malene har allerede en pen upersonlig variant når navnet mangler, så vi
 * returnerer null i stedet for å sende noe som ser automatisert ut.
 */
export function presentableCompanyName(name: string | null): string | null {
  const trimmed = name?.trim()
  if (!trimmed) return null
  return /\S+@\S+\.\S+/.test(trimmed) ? null : trimmed
}

/** template_id som lagres i seller_email_log (idempotensnøkkel per bedrift). */
export const LIFECYCLE_TEMPLATE_IDS: Record<LifecycleStage, string> = {
  velkomst: "lifecycle-velkomst",
  aktivering: "lifecycle-aktivering",
  verdi: "lifecycle-verdi",
  winback: "lifecycle-winback",
}
