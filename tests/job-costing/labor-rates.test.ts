import { describe, expect, it } from "vitest"

import { computeLaborCost } from "@/lib/job-costing/calc"
import { buildLaborRateResolver, sumLaborCost, type LaborRateRow } from "@/lib/job-costing/labor-rates"

const RATES: LaborRateRow[] = [
  { id: "r-tomrer", job_type: "Tømrerarbeid", hourly_rate_nok: 850, cost_rate_nok: 520 },
  { id: "r-bas", job_type: "Bas", hourly_rate_nok: 950, cost_rate_nok: "640.00" },
  { id: "r-elektro", job_type: "Elektriker", hourly_rate_nok: 1100, cost_rate_nok: null },
]

describe("buildLaborRateResolver", () => {
  it("bruker kostprisen på timeprisen den ansatte er koblet til", () => {
    const resolver = buildLaborRateResolver(RATES, [{ user_id: "ola", hourly_rate_id: "r-bas" }])
    expect(resolver.resolve("ola")).toEqual({
      costRateNok: 640,
      saleRateNok: 950,
      hourlyRateId: "r-bas",
      assignedJobType: "Bas",
      source: "ansatt",
    })
  })

  it("koblet til timepris uten kostpris → snittet, men jobbtypen beholdes", () => {
    const resolver = buildLaborRateResolver(RATES, [{ user_id: "kari", hourly_rate_id: "r-elektro" }])
    const resolved = resolver.resolve("kari")
    expect(resolved.source).toBe("snitt")
    expect(resolved.costRateNok).toBe(580) // (520 + 640) / 2
    expect(resolved.assignedJobType).toBe("Elektriker")
    expect(resolved.hourlyRateId).toBe("r-elektro")
    expect(resolved.saleRateNok).toBe(1100)
  })

  it("uten kobling → snittet av kostprisene som er satt", () => {
    const resolver = buildLaborRateResolver(RATES, [])
    expect(resolver.averageCostRateNok).toBe(580)
    expect(resolver.resolve("ukjent")).toEqual({
      costRateNok: 580,
      saleRateNok: null,
      hourlyRateId: null,
      assignedJobType: null,
      source: "snitt",
    })
  })

  it("kobling til en slettet timepris behandles som ingen kobling", () => {
    const resolver = buildLaborRateResolver(RATES, [{ user_id: "ola", hourly_rate_id: "finnes-ikke" }])
    expect(resolver.resolve("ola").source).toBe("snitt")
    expect(resolver.resolve("ola").hourlyRateId).toBeNull()
  })

  it("ingen kostpriser noe sted → 0 og kilde null", () => {
    const resolver = buildLaborRateResolver(
      [{ id: "r", job_type: "Maler", hourly_rate_nok: 700, cost_rate_nok: null }],
      [{ user_id: "ola", hourly_rate_id: "r" }]
    )
    expect(resolver.resolve("ola")).toMatchObject({ costRateNok: 0, source: null, assignedJobType: "Maler" })
    expect(resolver.resolve("kari")).toMatchObject({ costRateNok: 0, source: null })
  })

  it("coverage skiller ansatte med egen kostpris fra dem som regnes med snittet", () => {
    const resolver = buildLaborRateResolver(RATES, [
      { user_id: "ola", hourly_rate_id: "r-bas" },
      { user_id: "kari", hourly_rate_id: "r-elektro" },
    ])
    expect(
      resolver.coverage([
        { userId: "ola", name: "Ola" },
        { userId: "kari", name: "Kari" },
        { userId: "per", name: "Per" },
      ])
    ).toEqual({
      total: 3,
      assigned: 1,
      missing: [
        { userId: "kari", name: "Kari" },
        { userId: "per", name: "Per" },
      ],
      averageCostRateNok: 580,
    })
  })
})

describe("sumLaborCost", () => {
  it("summerer timer × kostpris per ansatt", () => {
    const resolver = buildLaborRateResolver(RATES, [
      { user_id: "ola", hourly_rate_id: "r-bas" },
      { user_id: "lars", hourly_rate_id: "r-tomrer" },
    ])
    // 10 × 640 + 20 × 520 + 4 × 580 (snitt)
    expect(
      sumLaborCost(
        [
          { userId: "ola", hours: 10 },
          { userId: "lars", hours: 20 },
          { userId: "per", hours: 4 },
        ],
        resolver.resolve
      )
    ).toBe(19120)
  })

  it("uten koblinger gir det samme som før: sum timer × snitt", () => {
    const resolver = buildLaborRateResolver(RATES, [])
    const entries = [
      { userId: "a", hours: 7.25 },
      { userId: "b", hours: 3.5 },
      { userId: "c", hours: 0.75 },
    ]
    expect(sumLaborCost(entries, resolver.resolve)).toBe(computeLaborCost(11.5, 580))
  })

  it("ignorerer ugyldige timer", () => {
    const resolver = buildLaborRateResolver(RATES, [])
    expect(sumLaborCost([{ userId: "a", hours: Number.NaN }, { userId: "b", hours: -3 }], resolver.resolve)).toBe(0)
  })
})
