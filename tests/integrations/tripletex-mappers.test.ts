import { describe, expect, it } from "vitest"

import { mapOrderFromOffer } from "../../lib/integrations/tripletex/mappers"

describe("mapOrderFromOffer", () => {
  it("maps line items to Tripletex order lines with ex-VAT unit prices", () => {
    const payload = mapOrderFromOffer(
      {
        id: "offer-1",
        title: "Bad-renovering",
        description: null,
        amount_nok: 50000,
        line_items: [
          {
            id: "1",
            subproject: "Bad",
            title: "Flislegging",
            description: "Gulv og vegger",
            quantity: 10,
            unit: "m2",
            supplier: "Byggmakker",
            unitPriceNok: 800,
            markupPercent: 10,
            discountPercent: 0,
          },
          {
            id: "2",
            subproject: "Bad",
            title: "Rørlegger",
            description: "",
            quantity: 8,
            unit: "time",
            supplier: "Intern",
            unitPriceNok: 950,
            markupPercent: 0,
            discountPercent: 5,
          },
        ],
      },
      101,
      202,
      { defaultVatTypeId: 3, defaultAccountId: 3000 }
    )

    expect(payload.customer).toEqual({ id: 101 })
    expect(payload.project).toEqual({ id: 202 })
    expect(payload.isPrioritizeAmountsIncludingVat).toBe(false)
    expect(payload.orderLines).toHaveLength(2)

    const firstLine = payload.orderLines[0] as Record<string, unknown>
    expect(firstLine.count).toBe(10)
    expect(firstLine.unitPriceExcludingVatCurrency).toBe(880)
    expect(firstLine.vatType).toEqual({ id: 3 })
    expect(firstLine.account).toEqual({ id: 3000 })
    expect(String(firstLine.description)).toContain("Flislegging")
  })

  it("falls back to summary line when no line items exist", () => {
    const payload = mapOrderFromOffer(
      {
        id: "offer-2",
        title: "Enkel ordre",
        description: null,
        amount_nok: 12000,
        line_items: [],
      },
      1,
      2
    )

    expect(payload.orderLines).toHaveLength(1)
    expect((payload.orderLines[0] as Record<string, unknown>).unitPriceExcludingVatCurrency).toBe(12000)
  })
})
