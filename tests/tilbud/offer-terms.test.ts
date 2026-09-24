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

  it("privatkunde får byggblankettene for forbruker, ikke NS-standardene", () => {
    expect(values("privatperson")).toEqual(["none", "bb3501", "bb3425", "custom"])
  })

  it("bedriftskunde får NS 8405/8407 og underentreprise (NS 8416/8417)", () => {
    expect(values("bedrift")).toEqual(["none", "ns8405", "ns8407", "ns8416", "ns8417", "custom"])
  })

  it("ukjent kundetype viser alle", () => {
    expect(values(null)).toHaveLength(8)
  })

  it("advarer når kontraktsgrunnlaget ikke passer kunden", () => {
    expect(contractBasisWarning("ns8405", "privatperson")).toMatch(/Byggblankett 3501\/3502/)
    // NS 8416/8417 er underentreprise mellom profesjonelle — aldri for forbruker
    expect(contractBasisWarning("ns8417", "privatperson")).toMatch(/profesjonelle parter/)
    expect(contractBasisWarning("bb3501", "bedrift")).toMatch(/forbrukere/)
    expect(contractBasisWarning("bb3501", "privatperson")).toBeNull()
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

  it("skriver byggblanketten i vilkårene", () => {
    expect(buildContractTerms("time_materials", "bb3501", "privatperson")[1]).toMatch(
      /^Kontraktsgrunnlag: Byggblankett 3501\/3502 \(håndverkertjenesteloven/
    )
  })

  it("prisoverslag til privatkunde har 15 %-taket, til bedrift ikke", () => {
    const privat = buildContractTerms("time_materials", "none", "privatperson")[0]
    expect(privat).toMatch(/ikke med mer enn 15 prosent/)
    expect(privat).toMatch(/håndverkertjenesteloven § 32/)
    // Varsling gir ingen rett til å overskride overfor forbruker
    expect(privat).not.toMatch(/varsles kunden før arbeidet fortsetter/)
    expect(buildContractTerms("time_materials", "none", "bedrift")[0]).not.toMatch(/15 prosent/)
  })

  it("fastpris til privatkunde nevner hastearbeid etter § 9", () => {
    expect(buildContractTerms("fixed", "none", "privatperson")[0]).toMatch(/håndverkertjenesteloven § 9/)
  })
})
