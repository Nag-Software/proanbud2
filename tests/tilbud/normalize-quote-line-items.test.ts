import { describe, expect, it } from "vitest"

import { normalizeQuoteLineItems, normalizeQuoteSubproject } from "../../lib/tilbud/normalize-quote-line-items"
import { type OfferLineItem } from "../../lib/tilbud/types"

function makeLineItem(overrides: Partial<OfferLineItem> = {}): OfferLineItem {
  return {
    id: "line-1",
    subproject: "Generelt",
    title: "Undertak 22mm",
    description: "",
    quantity: 10,
    unit: "kvm",
    supplier: "Byggmakker",
    unitPriceNok: 100,
    markupPercent: 15,
    discountPercent: 0,
    ...overrides,
  }
}

describe("normalizeQuoteSubproject", () => {
  it("collapses Tak - undertak to Tak", () => {
    expect(normalizeQuoteSubproject("Tak - undertak")).toBe("Tak")
    expect(normalizeQuoteSubproject("Yttervegger - isolasjon")).toBe("Yttervegger")
  })

  it("keeps broad categories unchanged", () => {
    expect(normalizeQuoteSubproject("Elektro")).toBe("Elektro")
  })
})

describe("normalizeQuoteLineItems", () => {
  it("normalizes subproject and unit from company price rows", () => {
    const { lineItems, warnings } = normalizeQuoteLineItems({
      lineItems: [
        makeLineItem({
          subproject: "Tak - bordplate",
          title: "Undertak 22mm",
          unit: "stk",
          supplierSku: "SKU-1",
        }),
      ],
      companyRows: [
        {
          product: "Undertak 22mm",
          unit: "m²",
          net_price: 123.45,
          list_price: 150,
          supplier_name: "Optimera",
          supplier_sku: "SKU-1",
          nobb: null,
          category: null,
        },
      ],
    })

    expect(lineItems[0]?.subproject).toBe("Tak")
    expect(lineItems[0]?.unit).toBe("m2")
    expect(lineItems[0]?.unitPriceNok).toBe(123.45)
    expect(lineItems[0]?.priceSource).toBe("prisfil")
    expect(warnings.some((warning) => warning.includes("Tak"))).toBe(true)
  })

  it("varsler når prisen blir overskrevet av prisfilen", () => {
    const { warnings } = normalizeQuoteLineItems({
      lineItems: [makeLineItem({ unitPriceNok: 100, supplierSku: "SKU-1" })],
      companyRows: [
        {
          product: "Undertak 22mm",
          unit: "kvm",
          net_price: 123.45,
          list_price: null,
          supplier_name: "Optimera",
          supplier_sku: "SKU-1",
          nobb: null,
          category: null,
        },
      ],
    })

    const priceWarning = warnings.find((w) => w.includes("Prisen for"))
    expect(priceWarning).toContain("100 kr")
    expect(priceWarning).toContain("123,45 kr")
    expect(priceWarning).toContain("Optimera")
  })

  it("overskriver IKKE prisen på et delstreng-treff", () => {
    // Regresjon: «Gips» traff før hvilken som helst rad med «gips» i navnet, og
    // prisen ble byttet til feil produkt uten at noen fikk beskjed.
    const { lineItems, warnings } = normalizeQuoteLineItems({
      lineItems: [makeLineItem({ title: "Gips", unitPriceNok: 89 })],
      companyRows: [
        {
          product: "Gipsplate 13mm vindtett 1200x2400",
          unit: "stk",
          net_price: 210,
          list_price: null,
          supplier_name: "Optimera",
          supplier_sku: "X",
          nobb: null,
          category: null,
        },
      ],
    })

    expect(lineItems[0]?.unitPriceNok).toBe(89)
    expect(lineItems[0]?.priceSource).toBe("anslag")
    expect(warnings.some((w) => w.includes("Prisen for"))).toBe(false)
  })

  it("lar prisen stå når samme produktnavn har ulik pris i flere filer", () => {
    const row = (net_price: number, supplier_name: string) => ({
      product: "Undertak 22mm",
      unit: "kvm",
      net_price,
      list_price: null,
      supplier_name,
      supplier_sku: null,
      nobb: null,
      category: null,
    })

    const { lineItems, warnings } = normalizeQuoteLineItems({
      lineItems: [makeLineItem({ unitPriceNok: 100 })],
      companyRows: [row(123, "Optimera"), row(180, "Byggmakker")],
    })

    expect(lineItems[0]?.unitPriceNok).toBe(100)
    expect(warnings.some((w) => w.includes("finnes 2 ganger"))).toBe(true)
  })

  it("merker ikke arbeidslinjer som anslag", () => {
    const { lineItems } = normalizeQuoteLineItems({
      lineItems: [makeLineItem({ title: "Flislegging vegg", unit: "time", unitPriceNok: 890 })],
      companyRows: [],
    })

    expect(lineItems[0]?.priceSource).toBeUndefined()
  })

  it("lar eksisterende kilde stå (linjer fra før feltet fantes blir ikke stemplet)", () => {
    const { lineItems } = normalizeQuoteLineItems({
      lineItems: [makeLineItem({ priceSource: "lagret-jobb", unit: "fastpris" })],
      companyRows: [],
    })

    expect(lineItems[0]?.priceSource).toBe("lagret-jobb")
  })
})
