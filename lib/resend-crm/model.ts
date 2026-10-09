// Ren logikk for Resend-synken: hvilken bøtte en bedrift hører til, hvilke
// segmenter det gir, og hvilke events en overgang skal utløse. Ingen I/O, så
// alt her er enhetstestet (tests/resend-crm/model.test.ts).

export type Bucket = "proeve" | "utlopt" | "betalende" | "avsluttet"

/**
 * Segmentnavnene i Resend. Gratisplanen tillater 3 segmenter, så utløpt prøve
 * og avsluttede kunder deler «Ikke betalende», og de som er midt i prøven
 * har ikke eget segment (sekvensene i Resend håndterer dem).
 * Endres de her, må de endres i scripts/resend-crm-setup.mjs også.
 */
export const SEGMENT_ALL = "Alle prøvebrukere"
export const SEGMENT_BY_BUCKET: Record<Bucket, string | null> = {
  proeve: null,
  utlopt: "Ikke betalende",
  betalende: "Betalende",
  avsluttet: "Ikke betalende",
}

/** Alle segmentnavn synken eier (uten duplikater). */
export const ALL_SEGMENTS: string[] = [
  SEGMENT_ALL,
  ...new Set(Object.values(SEGMENT_BY_BUCKET).filter((n): n is string => Boolean(n))),
]

/** Event-navnene automatiseringene i Resend lytter på. */
export const EVENTS = {
  trialStarted: "proeve.startet",
  firstOfferSent: "tilbud.forste_sendt",
  trialExpired: "proeve.utlopt",
  paid: "abonnement.betalt",
  canceled: "abonnement.avsluttet",
} as const

export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

/**
 * Stripe-status → bøtte. `past_due` regnes som betalende (betalingen feilet
 * etter at de har betalt før). Alt som ikke lever, er «utløpt» for den som
 * aldri betalte og «avsluttet» for den som gjorde det.
 * `incomplete` uten tidligere betaling = har aldri kommet i gang → null (synkes ikke).
 */
export function bucketFor(status: string | null | undefined, everPaid: boolean): Bucket | null {
  switch (status) {
    case "trialing":
      return "proeve"
    case "active":
    case "past_due":
      return "betalende"
    case "canceled":
    case "unpaid":
    case "paused":
      return everPaid ? "avsluttet" : "utlopt"
    case "incomplete":
      return everPaid ? "avsluttet" : null
    default:
      return null
  }
}

export type SyncState = {
  bucket: Bucket
  hasSentOffer: boolean
  everPaid: boolean
}

/**
 * Events som skal sendes når tilstanden går fra `prev` til `next`.
 *
 * `prev = null` betyr at bedriften aldri er synket før. Da sendes bare
 * `proeve.startet`, og bare hvis `isFreshSignup` — ellers ville første synk
 * (eller en backfill) sendt velkomst-e-post til gamle brukere.
 */
export function eventsForTransition(
  prev: SyncState | null,
  next: SyncState,
  opts: { isFreshSignup: boolean }
): EventName[] {
  const events: EventName[] = []

  if (!prev) {
    if (next.bucket === "proeve" && opts.isFreshSignup) {
      events.push(EVENTS.trialStarted)
      if (next.hasSentOffer) events.push(EVENTS.firstOfferSent)
    }
    return events
  }

  if (next.bucket === "proeve" && prev.bucket !== "proeve") events.push(EVENTS.trialStarted)
  if (next.hasSentOffer && !prev.hasSentOffer) events.push(EVENTS.firstOfferSent)
  if (prev.bucket === "proeve" && next.bucket === "utlopt") events.push(EVENTS.trialExpired)
  if (next.bucket === "betalende" && prev.bucket !== "betalende") events.push(EVENTS.paid)
  if (prev.bucket === "betalende" && next.bucket === "avsluttet") events.push(EVENTS.canceled)

  return events
}

/** Segmentene en kontakt i denne bøtta skal være med i. */
export function segmentsFor(bucket: Bucket): string[] {
  const own = SEGMENT_BY_BUCKET[bucket]
  return own ? [SEGMENT_ALL, own] : [SEGMENT_ALL]
}

/** Segmentene kontakten skal fjernes fra (alle synk-segmenter den ikke skal være i). */
export function segmentsToLeave(bucket: Bucket): string[] {
  const keep = new Set(segmentsFor(bucket))
  return ALL_SEGMENTS.filter((name) => !keep.has(name))
}

/** «Ola Nordmann» → «Ola». Tomt/manglende → null (Resend bruker da fallback). */
export function firstNameOf(fullName: string | null | undefined): string | null {
  const first = fullName?.trim().split(/\s+/)[0]
  return first ? first : null
}
