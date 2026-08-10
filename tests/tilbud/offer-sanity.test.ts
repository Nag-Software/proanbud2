import { describe, expect, it } from "vitest"

import { checkOfferSanity } from "@/lib/tilbud/offer-sanity"
import type { OfferLineItem } from "@/lib/tilbud/types"
import type { NormalPriceRow } from "@/lib/tilbud/normal-prices"

function item(overrides: Partial<OfferLineItem> = {}): OfferLineItem {
  return {
    id: crypto.randomUUID(),
    subproject: "Bad",
    title: "Flis 30x60",
    description: "",
    quantity: 10,
    unit: "m2",
    supplier: "Megaflis",
    unitPriceNok: 400,
    markupPercent: 0,
    discountPercent: 0,
    ...overrides,
  }
}

const labor = () => item({ title: "Arbeid", unit: "time", quantity: 30, unitPriceNok: 890 })

const badReference: NormalPriceRow = {
  id: "n1",
  project_type: "Bad",
  slug: "bad",
  price_low_nok: 35000,
  price_normal_nok: 55000,
  price_high_nok: 80000,
  typical_total_min_nok: 160000,
  typical_total_max_nok: 960000,
  unit: "m2",
}

describe("checkOfferSanity", () => {
  it("varsler når en pakningspris er ganget opp som et areal", () => {
    // Klassisk enhetstabbe: prisen gjelder per pall, mengden er kvadratmeter.
    const warnings = checkOfferSanity({
      lineItems: [item({ title: "Takstein", unit: "pall", quantity: 180, unitPriceNok: 9500 }), labor()],
    })

    expect(warnings.some((w) => w.includes("Takstein") && w.includes("per pall"))).toBe(true)
  })

  it("varsler ikke på et normalt antall pakninger", () => {
    const warnings = checkOfferSanity({
      lineItems: [item({ title: "Skruer", unit: "pk", quantity: 8, unitPriceNok: 249 }), labor()],
    })

    expect(warnings.some((w) => w.includes("per pk"))).toBe(false)
  })

  it("varsler når én linje dominerer totalen", () => {
    const warnings = checkOfferSanity({
      lineItems: [item({ title: "Vindu", quantity: 1, unitPriceNok: 500000 }), labor()],
    })

    expect(warnings.some((w) => w.includes("Vindu") && w.includes("% av hele tilbudet"))).toBe(true)
  })

  it("varsler når kvadratmeterprisen er absurd høy mot referansen", () => {
    // 10 m² bad til 5 mill = 500 000 kr/m², mot 35–80 000 som er vanlig.
    const warnings = checkOfferSanity({
      lineItems: [item({ quantity: 10, unitPriceNok: 500000 }), labor()],
      areaM2: 10,
      normalPrice: badReference,
    })

    expect(warnings.some((w) => w.includes("per m²"))).toBe(true)
  })

  it("varsler ikke på en kvadratmeterpris innenfor referansespennet", () => {
    const warnings = checkOfferSanity({
      lineItems: [item({ quantity: 10, unitPriceNok: 45000 }), labor()],
      areaM2: 10,
      normalPrice: badReference,
    })

    expect(warnings.some((w) => w.includes("per m²"))).toBe(false)
  })

  it("varsler når arbeidslinjer mangler helt", () => {
    const warnings = checkOfferSanity({ lineItems: [item()] })
    expect(warnings.some((w) => w.includes("ingen arbeidslinjer"))).toBe(true)
  })

  it("er stille på en normal kalkyle", () => {
    const warnings = checkOfferSanity({
      lineItems: [
        item({ quantity: 12, unitPriceNok: 400 }),
        item({ title: "Membran", unit: "spann", quantity: 2, unitPriceNok: 849 }),
        labor(),
      ],
    })

    expect(warnings).toEqual([])
  })
})

describe("checkOfferSanity: arbeid skal ikke utløse dominans-varsel", () => {
  it("er stille når arbeid utgjør mesteparten av tilbudet", () => {
    // Vanlig i håndverksbedrifter: mest arbeid, lite materiell. Et varsel her
    // ville dukket opp på nesten hvert tilbud og gjort resten verdiløs.
    const warnings = checkOfferSanity({
      lineItems: [
        item({ title: "Silikon", unit: "stk", quantity: 2, unitPriceNok: 120 }),
        item({ title: "Arbeid", unit: "time", quantity: 40, unitPriceNok: 950 }),
      ],
    })

    expect(warnings).toEqual([])
  })
})
