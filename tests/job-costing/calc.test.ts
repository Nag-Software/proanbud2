import { describe, expect, it } from "vitest"

import {
  averageCostRate,
  computeEstimatedMaterialCost,
  computeJobCosting,
  computeLaborCost,
  computeOfferRevenue,
  computePlannedCosts,
  isHourUnit,
  lineUnitCost,
  resolveApprovedHours,
} from "../../lib/job-costing/calc"
import type { OfferLineItem } from "../../lib/tilbud/types"

const lineItems: OfferLineItem[] = [
  { id: "1", subproject: "Bad", title: "Flis", description: "", quantity: 10, unit: "m2", supplier: "", unitPriceNok: 800, markupPercent: 10, discountPercent: 0 },
  { id: "2", subproject: "Bad", title: "Rør", description: "", quantity: 8, unit: "time", supplier: "", unitPriceNok: 950, markupPercent: 0, discountPercent: 5 },
]

describe("job-costing calc", () => {
  it("omsetning = tilbudets subtotal (påslag inkl., rabatt trukket)", () => {
    // 10*880 + 8*902.5 = 8800 + 7220
    expect(computeOfferRevenue(lineItems)).toBe(16020)
  })

  it("estimert materialkost = mengde × innkjøpspris (før påslag)", () => {
    // 10*800 + 8*950 = 8000 + 7600
    expect(computeEstimatedMaterialCost(lineItems)).toBe(15600)
  })

  it("lønnskost = timer × kostpris, robust mot 0/negativ", () => {
    expect(computeLaborCost(40, 550)).toBe(22000)
    expect(computeLaborCost(0, 550)).toBe(0)
    expect(computeLaborCost(10, -5)).toBe(0)
  })

  it("dekningsbidrag og margin%", () => {
    const c = computeJobCosting({ revenueNok: 16020, laborCostNok: 8000, materialCostNok: 4000 })
    expect(c.marginNok).toBe(4020)
    expect(c.marginPct).toBe(25.09)
  })

  it("margin% er null når omsetning er 0", () => {
    const c = computeJobCosting({ revenueNok: 0, laborCostNok: 1000, materialCostNok: 0 })
    expect(c.marginPct).toBeNull()
  })

  it("timeenheter kjennes igjen, alt annet er material", () => {
    expect(isHourUnit("time")).toBe(true)
    expect(isHourUnit(" Timer ")).toBe(true)
    expect(isHourUnit("t")).toBe(true)
    expect(isHourUnit("m2")).toBe(false)
    expect(isHourUnit("fastpris")).toBe(false)
    expect(isHourUnit(undefined)).toBe(false)
  })

  it("kalkylen splittes i lønn og material: material på innpris, timer på kostpris", () => {
    // Linje 1: 10 m2 × 800 = 8000 material. Linje 2: 8 timer à 950 kr/t er SALGSpris —
    // uten kostpris noe sted blir lønnskosten 0, og salgsverdien ligger i laborSalesNok.
    const planned = computePlannedCosts(lineItems)
    expect(planned.materialCostNok).toBe(8000)
    expect(planned.laborCostNok).toBe(0)
    expect(planned.laborSalesNok).toBe(7600)
    expect(planned.laborCostCoveredHours).toBe(0)
    expect(planned.hours).toBe(8)
    expect(planned.fixedPriceRevenueNok).toBe(0)
    expect(planned.costBasisRevenueNok).toBe(16020)
  })

  it("timelinjer med kostpris fra timeprisen bruker den; linjer uten bruker snittet", () => {
    const withSnapshot: OfferLineItem = { ...lineItems[1], id: "2b", costRateNok: 520 }
    const planned = computePlannedCosts([lineItems[0], withSnapshot, lineItems[1]], {
      fallbackLaborCostRateNok: 450,
    })
    // 8 × 520 (snapshot) + 8 × 450 (snitt)
    expect(planned.laborCostNok).toBe(7760)
    expect(planned.laborCostCoveredHours).toBe(16)
    expect(planned.laborSalesNok).toBe(15200)
    expect(planned.hours).toBe(16)
  })

  it("kostpris 0 på linja teller som «ikke satt» og faller tilbake på snittet", () => {
    const planned = computePlannedCosts([{ ...lineItems[1], costRateNok: 0 }], { fallbackLaborCostRateNok: 400 })
    expect(planned.laborCostNok).toBe(3200)
  })

  it("fastprislinjer er salgspris, ikke kostnad — de holdes utenfor kalkylen", () => {
    const fastpris: OfferLineItem = {
      id: "3",
      subproject: "",
      title: "Komplett bad",
      description: "",
      quantity: 1,
      unit: "fastpris",
      supplier: "",
      unitPriceNok: 74750,
      markupPercent: 0,
      discountPercent: 0,
    }
    const planned = computePlannedCosts([fastpris])
    expect(planned.materialCostNok).toBe(0)
    expect(planned.laborCostNok).toBe(0)
    expect(planned.fixedPriceRevenueNok).toBe(74750)
    expect(planned.costBasisRevenueNok).toBe(0)
  })

  it("fastprislinjer med timer teller i timekalkylen, men ikke i kostgrunnlaget", () => {
    const planned = computePlannedCosts([
      ...lineItems,
      { id: "3", subproject: "Bad", title: "Vindusbytte", description: "", quantity: 2, unit: "fastpris", supplier: "", unitPriceNok: 6000, markupPercent: 0, discountPercent: 0, plannedHours: 3.5 },
    ])
    // 8 timer fra timelinjen + 2 × 3,5 fra fastprisjobben
    expect(planned.hours).toBe(15)
    expect(planned.costBasisHours).toBe(8)
    expect(planned.fixedPriceRevenueNok).toBe(12000)
    expect(planned.laborSalesNok).toBe(7600)
  })

    it("kalkylen tåler tomme og ugyldige linjer", () => {
    const empty = {
      laborCostNok: 0,
      laborSalesNok: 0,
      laborCostCoveredHours: 0,
      materialCostNok: 0,
      hours: 0,
      costBasisHours: 0,
      costBasisRevenueNok: 0,
      fixedPriceRevenueNok: 0,
    }
    expect(computePlannedCosts([])).toEqual(empty)
    const broken = [{ ...lineItems[0], quantity: Number.NaN, unitPriceNok: Number.NaN }]
    expect(computePlannedCosts(broken)).toEqual(empty)
  })

  it("godkjente timer: manuell overstyring vinner alltid når satt", () => {
    expect(resolveApprovedHours(60, 50)).toEqual({ value: 60, source: "manuell" })
    expect(resolveApprovedHours(0, 50)).toEqual({ value: 0, source: "manuell" })
  })

  it("godkjente timer: faller tilbake til tilbudets timer uten overstyring", () => {
    expect(resolveApprovedHours(null, 50)).toEqual({ value: 50, source: "tilbud" })
  })

  it("godkjente timer: null når verken overstyrt eller tilbud har timelinjer", () => {
    expect(resolveApprovedHours(null, null)).toEqual({ value: null, source: null })
    expect(resolveApprovedHours(null, 0)).toEqual({ value: null, source: null })
  })
})

describe("averageCostRate", () => {
  it("averages only the cost rates that are actually set", () => {
    expect(averageCostRate([{ cost_rate_nok: 400 }, { cost_rate_nok: "500" }, { cost_rate_nok: null }, { cost_rate_nok: 0 }])).toBe(450)
  })

  it("returns 0 when no cost rate is set", () => {
    expect(averageCostRate([])).toBe(0)
    expect(averageCostRate([{ cost_rate_nok: null }])).toBe(0)
  })
})

describe("lineUnitCost", () => {
  it("uses innpris for material, cost rate for hours, and nothing for fixed price", () => {
    expect(lineUnitCost({ unit: "m2", unitPriceNok: 800 }, 450)).toBe(800)
    expect(lineUnitCost({ unit: "Time", unitPriceNok: 950 }, 450)).toBe(450)
    expect(lineUnitCost({ unit: "time", unitPriceNok: 950 }, 0)).toBeNull()
    expect(lineUnitCost({ unit: "RS", unitPriceNok: 5000 }, 450)).toBeNull()
  })

  it("foretrekker kostprisen linja fikk fra timeprisen framfor snittet", () => {
    expect(lineUnitCost({ unit: "time", unitPriceNok: 950, costRateNok: 500 }, 450)).toBe(500)
    expect(lineUnitCost({ unit: "time", unitPriceNok: 950, costRateNok: 0 }, 450)).toBe(450)
    expect(lineUnitCost({ unit: "time", unitPriceNok: 950, costRateNok: 500 }, null)).toBe(500)
    // Snapshot på en materiallinje er støy og skal ikke brukes.
    expect(lineUnitCost({ unit: "stk", unitPriceNok: 120, costRateNok: 500 }, 450)).toBe(120)
  })
})
