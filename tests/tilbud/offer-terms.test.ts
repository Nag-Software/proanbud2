import { describe, expect, it } from "vitest"

import {
  DEFAULT_PRICING_MODEL,
  buildContractTerms,
  toSelectablePricingModel,
} from "@/lib/tilbud/offer-terms"

describe("offer terms", () => {
  it("bruker regningsarbeid som standard prismodell", () => {
    expect(DEFAULT_PRICING_MODEL).toBe("time_materials")
  })

  it("bygger prismodell før kontraktsgrunnlag", () => {
    const terms = buildContractTerms("fixed", "ns8405")
    expect(terms).toHaveLength(2)
    expect(terms[0]).toMatch(/^Prismodell: Fastpris\./)
    expect(terms[1]).toMatch(/^Kontraktsgrunnlag: NS 8405/)
  })

  it("utelater kontraktsgrunnlag «none» og manglende prismodell", () => {
    expect(buildContractTerms(null, "none")).toEqual([])
    expect(buildContractTerms("time_materials", null)).toHaveLength(1)
  })

  it("beholder tekst for eldre prismodeller, men tilbyr dem ikke som valg", () => {
    expect(buildContractTerms("unit_price", "none")[0]).toMatch(/^Prismodell: Enhetspriser\./)
    expect(toSelectablePricingModel("unit_price")).toBeNull()
    expect(toSelectablePricingModel("mixed")).toBeNull()
    expect(toSelectablePricingModel("fixed")).toBe("fixed")
  })
})
