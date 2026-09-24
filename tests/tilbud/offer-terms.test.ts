import { describe, expect, it } from "vitest"

import {
  DEFAULT_PRICING_MODEL,
  buildContractTerms,
  contractBasisOptionsFor,
  contractBasisWarning,
  initialContractBasisFor,
  resolveCustomerKind,
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

describe("kontraktsgrunnlag etter kundetype", () => {
  const values = (kind: Parameters<typeof contractBasisOptionsFor>[0]) =>
    contractBasisOptionsFor(kind).map((option) => option.value)

  it("privatkunde får forbrukerstandardene, ikke NS 8405/8407", () => {
    expect(values("privatperson")).toEqual(["none", "ns8416", "ns8417", "custom"])
  })

  it("bedriftskunde får NS 8405/8407, ikke forbrukerstandardene", () => {
    expect(values("bedrift")).toEqual(["none", "ns8405", "ns8407", "custom"])
  })

  it("ukjent kundetype viser alle standardene", () => {
    expect(values(null)).toHaveLength(6)
  })

  it("advarer når standarden ikke passer kunden", () => {
    expect(contractBasisWarning("ns8405", "privatperson")).toMatch(/NS 8417/)
    expect(contractBasisWarning("ns8417", "bedrift")).toMatch(/forbrukerstandard/)
    expect(contractBasisWarning("ns8417", "privatperson")).toBeNull()
    expect(contractBasisWarning("ns8405", null)).toBeNull()
  })

  it("bruker bedriftens standard bare når den passer kunden", () => {
    expect(initialContractBasisFor("ns8405", "bedrift")).toBe("ns8405")
    expect(initialContractBasisFor("ns8405", "privatperson")).toBe("none")
    expect(initialContractBasisFor(undefined, "privatperson")).toBe("none")
  })

  it("regner kunder med org.nr. som bedrift og øvrige som privatperson, som Kunder-siden", () => {
    expect(resolveCustomerKind({ orgNumber: "923456789" })).toBe("bedrift")
    expect(resolveCustomerKind({ orgNumber: "" })).toBe("privatperson")
    expect(resolveCustomerKind({ orgNumber: null })).toBe("privatperson")
    expect(resolveCustomerKind(null)).toBeNull()
  })

  it("skriver forbrukerstandarden i vilkårene", () => {
    expect(buildContractTerms("time_materials", "ns8417")[1]).toMatch(/^Kontraktsgrunnlag: NS 8417/)
  })
})
