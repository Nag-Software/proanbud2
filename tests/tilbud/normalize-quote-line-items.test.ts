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
          category: null,
          supplier_name: "Optimera",
          supplier_sku: "SKU-1",
          nobb: null,
        },
      ],
    })

    expect(lineItems[0]?.subproject).toBe("Tak")
    expect(lineItems[0]?.unit).toBe("m2")
    expect(lineItems[0]?.unitPriceNok).toBe(123.45)
    expect(warnings.some((warning) => warning.includes("Tak"))).toBe(true)
  })
})
