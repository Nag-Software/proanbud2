// Reglene for påfyll — rene funksjoner, så de kan testes (pafyll.ts drar inn
// server-only via feilloggen).
//
// Maskinen eier kilden: holder det som venter på research og utkast
// («drivstoffet») seg under det Casper rekker å godkjenne på en dag, henter den
// en ny porsjon fra Brønnøysund. Men aldri oftere enn hver tredje time, og
// aldri mer enn fire porsjoner i døgnet — et søk som av en eller annen grunn
// gir null e-postbare firmaer, skal ikke fylle innboksen med hundrevis.

/** Firmaer per porsjon. */
export const REFILL_BATCH = 25

/** Minste tid mellom to automatiske porsjoner. «Kjør nå» venter ikke. */
export const REFILL_MIN_HOURS_BETWEEN = 3

/** Maks porsjoner per døgn (norsk tid), også når Casper trykker «Kjør nå». */
export const REFILL_MAX_PER_DAY = 4

export type RefillDecision = { refill: boolean; reason: string }

export function refillDecision(input: {
  /** Firmaer som kan få e-post og som maskinen ennå ikke har skrevet til. */
  fuel: number
  /** Hvor mange maskinen skal ha å jobbe med — selger_settings.daily_new_drafts. */
  capacity: number
  lastRefillAt: string | null
  refillsToday: number
  now: Date
  /** «Kjør nå»: Casper vil ha det nå, så ventetiden gjelder ikke. Døgntaket gjør. */
  manual?: boolean
}): RefillDecision {
  if (input.capacity <= 0) {
    return { refill: false, reason: "Påfyll er av — «nye utkast per dag» står på 0" }
  }
  if (input.fuel >= input.capacity) {
    return { refill: false, reason: `${input.fuel} firmaer venter allerede — nok å jobbe med` }
  }
  if (input.refillsToday >= REFILL_MAX_PER_DAY) {
    return { refill: false, reason: `Har allerede hentet ${input.refillsToday} ganger i dag` }
  }
  if (!input.manual && input.lastRefillAt) {
    const hours = (input.now.getTime() - Date.parse(input.lastRefillAt)) / 3_600_000
    if (hours < REFILL_MIN_HOURS_BETWEEN) {
      return { refill: false, reason: "Hentet for under tre timer siden" }
    }
  }
  return { refill: true, reason: `Bare ${input.fuel} firmaer å jobbe med` }
}
