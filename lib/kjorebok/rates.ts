// Statens satser for kjøregodtgjørelse (mileage allowance).
//
// Pure, dependency-free so it runs identically on server actions, the worker,
// and the client form preview. The rate is a per-year constant table: when the
// statutory rate changes, ADD a new entry — never mutate an old one, because
// each trip stores a rate snapshot (rate_nok_per_km/amount_nok) and historical
// trips must not shift retroactively.
//
// 2026: base 5,30 kr/km, + 1,00 kr/km per passenger, + 1,00 kr/km for
// anleggsvei (forest/construction road). Source: Skatteetaten / statens
// reiseregulativ.

export type StatensSats = {
  /** Base rate per km (kr). */
  baseNokPerKm: number
  /** Extra per km per passenger (kr). */
  passengerNokPerKm: number
  /** Extra per km when driving anleggsvei/skogsvei (kr). */
  anleggsveiNokPerKm: number
}

/** Statutory rates by year. Add a new entry each year; never edit past years. */
export const STATENS_SATSER_BY_YEAR: Record<number, StatensSats> = {
  2026: { baseNokPerKm: 5.3, passengerNokPerKm: 1.0, anleggsveiNokPerKm: 1.0 },
}

export const DEFAULT_SATS_YEAR = 2026

/** Resolve the rate table for a year, falling back to the default year. */
export function getStatensSats(year: number = DEFAULT_SATS_YEAR): StatensSats {
  return STATENS_SATSER_BY_YEAR[year] ?? STATENS_SATSER_BY_YEAR[DEFAULT_SATS_YEAR]
}

export type TripRateInput = {
  distanceKm: number
  passengers: number
  anleggsvei: boolean
  /** Defaults to DEFAULT_SATS_YEAR. */
  year?: number
}

/** Effective kr/km including passenger + anleggsvei surcharges. */
export function rateNokPerKm(input: Omit<TripRateInput, "distanceKm">): number {
  const sats = getStatensSats(input.year)
  const passengers = Number.isFinite(input.passengers) ? Math.max(0, Math.floor(input.passengers)) : 0
  const rate =
    sats.baseNokPerKm +
    passengers * sats.passengerNokPerKm +
    (input.anleggsvei ? sats.anleggsveiNokPerKm : 0)
  return roundOre(rate)
}

/**
 * Returns the two values persisted on a trip: the effective kr/km and the total
 * amount (distance × rate), both rounded to øre. `distanceKm` ≤ 0 yields 0.
 *
 * Note: private trips still compute an amount here — excluding private km from
 * reimbursable/Tripletex totals is the caller's responsibility (aggregation),
 * not this function's.
 */
export function computeTripAmount(input: TripRateInput): {
  rateNokPerKm: number
  amountNok: number
} {
  const rate = rateNokPerKm(input)
  const distance = Number.isFinite(input.distanceKm) ? Math.max(0, input.distanceKm) : 0
  return { rateNokPerKm: rate, amountNok: roundOre(distance * rate) }
}

/** Round to 2 decimals (øre), avoiding binary-float drift (e.g. 1.005 → 1.01). */
export function roundOre(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
