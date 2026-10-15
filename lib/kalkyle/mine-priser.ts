/**
 * Kobling mellom kalkylen og Mine priser (Timepriser og Lagrede jobber).
 *
 * - Timepriser: timelinjer prises med en timepris, og salgs- og kostprisen
 *   kopieres inn på linja (som på tilbudslinjer). Første timepris er
 *   bedriftens standard, og intern kost faller tilbake til snittet av
 *   kostprisene som er satt (samme regel som Lønnsomhet og regnskapet).
 * - Lagrede jobber: små fastprisjobber som legges inn som én linje
 *   («+ Fast jobb»). Hele poster lagres som maler, ikke som faste jobber.
 */
import type { CompanyHourlyRate } from "@/lib/tilbud/labor"
import type { SavedJobRow } from "@/lib/tilbud/saved-jobs"
import type { LagretJobb, Linje, Prising, TimeprisValg } from "./types"

export function fraTimepriser(rates: CompanyHourlyRate[]): TimeprisValg[] {
  return rates.map((r) => ({ id: r.id, navn: r.jobType, timesats: r.hourlyRateNok, internKost: r.costRateNok }))
}

export function fraLagredeJobber(rows: SavedJobRow[]): LagretJobb[] {
  return rows
    .map((row) => {
      const pris = Number(row.price_nok)
      const timer = row.estimated_hours == null ? null : Number(row.estimated_hours)
      return {
        id: String(row.id ?? ""),
        navn: String(row.name ?? "").trim(),
        pris: Number.isFinite(pris) && pris >= 0 ? pris : 0,
        timer: timer !== null && Number.isFinite(timer) && timer > 0 ? timer : null,
      }
    })
    .filter((j) => j.id && j.navn)
}

/** Snittet av kostprisene som er satt. Null når ingen er satt. */
export function snittKost(timepriser: TimeprisValg[]): number | null {
  const kost = timepriser.map((t) => t.internKost).filter((k): k is number => k != null && k > 0)
  return kost.length ? kost.reduce((a, b) => a + b, 0) / kost.length : null
}

/**
 * Standardprisingen for en ny kalkyle: første timepris er standard, intern kost
 * er dens kostpris eller snittet. Påslagene har ikke noe hjem i Mine priser
 * ennå, så de kommer fra `reserve`.
 */
export function standardPrising(timepriser: TimeprisValg[], reserve: Prising): Prising {
  const forste = timepriser[0]
  if (!forste) return reserve
  return {
    ...reserve,
    timesats: forste.timesats,
    internKostPerTime: forste.internKost ?? snittKost(timepriser) ?? reserve.internKostPerTime,
  }
}

/** En lagret jobb som linje i kalkylen. */
export function linjeFraLagretJobb(jobb: LagretJobb): Omit<Linje, "id"> {
  return {
    beskrivelse: jobb.navn,
    type: "jobb",
    antall: 1,
    enhet: "stk",
    innpris: null,
    fastpris: jobb.pris,
    timerPerEnhet: jobb.timer,
    lagretJobbId: jobb.id,
  }
}
