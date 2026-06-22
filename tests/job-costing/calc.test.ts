import { describe, expect, it } from "vitest"

import {
  computeEstimatedMaterialCost,
  computeJobCosting,
  computeLaborCost,
  computeOfferRevenue,
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
})
