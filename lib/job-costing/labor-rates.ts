/**
 * Kostpris per ansatt: hvilken kr/t timene en ansatt fører skal regnes med.
 *
 * Hver ansatt kan være koblet til én timepris (db/114 employee_hourly_rates).
 * Kostprisen på den timeprisen gjelder alle timer den ansatte fører. Ansatte
 * uten kobling — eller koblet til en timepris uten kostpris — regnes med
 * snittet av bedriftens kostpriser, slik alle ble før koblingen fantes.
 *
 * Ren modul uten databasekall, så den kan testes og importeres fra klienten
 * (typene brukes i UI-et). Serversiden henter rader og kaller resolveren.
 */

import { averageCostRate } from "@/lib/job-costing/calc"

/**
 * Hvor kostprisen på en ansatts timer kommer fra:
 * - `ansatt`: kostprisen på timeprisen den ansatte er koblet til.
 * - `snitt`: snittet av bedriftens kostpriser (ingen kobling, eller koblet til
 *   en timepris uten kostpris).
 * - `null`: ingen kostpris finnes noe sted — lønnskosten blir 0.
 */
export type LaborRateSource = "ansatt" | "snitt" | null

export type LaborRateRow = {
  id: string
  job_type: string | null
  hourly_rate_nok: unknown
  cost_rate_nok: unknown
}

export type EmployeeRateAssignment = {
  user_id: string
  hourly_rate_id: string
}

export type ResolvedLaborRate = {
  /** Kr/t timene regnes med. 0 når ingen kostpris finnes. */
  costRateNok: number
  /** Salgsprisen på den koblede timeprisen. Ikke brukt i v1 — klar for løpende timefakturering. */
  saleRateNok: number | null
  hourlyRateId: string | null
  /** Jobbtypen på den koblede timeprisen — satt også når kilden er `snitt` fordi timeprisen mangler kostpris. */
  assignedJobType: string | null
  source: LaborRateSource
}

export type LaborRateCoverage = {
  total: number
  /** Ansatte som regnes med egen kostpris (`source === "ansatt"`). */
  assigned: number
  /** Ansatte som regnes med snittet: uten kobling, eller koblet til en timepris uten kostpris. */
  missing: Array<{ userId: string; name: string }>
  averageCostRateNok: number
}

export type LaborRateResolver = {
  averageCostRateNok: number
  resolve(userId: string): ResolvedLaborRate
  coverage(users: Array<{ userId: string; name: string }>): LaborRateCoverage
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function buildLaborRateResolver(
  rates: LaborRateRow[],
  assignments: EmployeeRateAssignment[]
): LaborRateResolver {
  const averageCostRateNok = averageCostRate(rates)
  const rateById = new Map(rates.map((rate) => [rate.id, rate]))
  const rateIdByUser = new Map(assignments.map((row) => [row.user_id, row.hourly_rate_id]))

  const fallback: ResolvedLaborRate = {
    costRateNok: averageCostRateNok,
    saleRateNok: null,
    hourlyRateId: null,
    assignedJobType: null,
    source: averageCostRateNok > 0 ? "snitt" : null,
  }

  function resolve(userId: string): ResolvedLaborRate {
    const rateId = rateIdByUser.get(userId)
    // Koblinger til en timepris som ikke lenger finnes behandles som ingen kobling.
    const rate = rateId ? rateById.get(rateId) : undefined
    if (!rate) return fallback

    const cost = positiveNumber(rate.cost_rate_nok)
    const sale = positiveNumber(rate.hourly_rate_nok)
    const jobType = String(rate.job_type ?? "").trim() || null
    if (cost === null) {
      // Koblet, men timeprisen mangler kostpris: snittet, men vi vet hvilken sats.
      return { ...fallback, saleRateNok: sale, hourlyRateId: rate.id, assignedJobType: jobType }
    }
    return {
      costRateNok: round(cost),
      saleRateNok: sale,
      hourlyRateId: rate.id,
      assignedJobType: jobType,
      source: "ansatt",
    }
  }

  function coverage(users: Array<{ userId: string; name: string }>): LaborRateCoverage {
    const missing: LaborRateCoverage["missing"] = []
    let assigned = 0
    for (const user of users) {
      if (resolve(user.userId).source === "ansatt") assigned += 1
      else missing.push({ userId: user.userId, name: user.name })
    }
    return { total: users.length, assigned, missing, averageCostRateNok }
  }

  return { averageCostRateNok, resolve, coverage }
}

/**
 * Lønnskost = Σ timer × den ansattes kostpris. Summeres urundet og rundes én
 * gang, så et prosjekt uten koblinger gir nøyaktig samme tall som
 * `computeLaborCost(sumTimer, snitt)` gjorde før.
 */
export function sumLaborCost(
  entries: Array<{ userId: string; hours: number }>,
  resolve: (userId: string) => ResolvedLaborRate
): number {
  let total = 0
  for (const entry of entries) {
    const hours = Number.isFinite(entry.hours) && entry.hours > 0 ? entry.hours : 0
    total += hours * resolve(entry.userId).costRateNok
  }
  return round(total)
}
