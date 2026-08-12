import { describe, expect, it } from "vitest"

import {
  computeEstimatedMaterialCost,
  computeJobCosting,
  computeLaborCost,
  computeOfferRevenue,
  computePlannedCosts,
  isHourUnit,
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

  it("kalkylen splittes i lønn og material på selvkost, ikke salgspris", () => {
    // Linje 1: 10 m2 × 800 = 8000 material. Linje 2: 8 timer × 950 = 7600 lønn.
    const planned = computePlannedCosts(lineItems)
    expect(planned.materialCostNok).toBe(8000)
    expect(planned.laborCostNok).toBe(7600)
    expect(planned.hours).toBe(8)
    expect(planned.fixedPriceRevenueNok).toBe(0)
    expect(planned.costBasisRevenueNok).toBe(16020)
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

  it("kalkylen tåler tomme og ugyldige linjer", () => {
    const empty = {
      laborCostNok: 0,
      materialCostNok: 0,
      hours: 0,
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
