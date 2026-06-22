import { describe, expect, it } from "vitest"

import {
  mapOrderFromOffer,
  mapProjectOfferFromOffer,
  mapTilbudOrderLinesFromOffer,
} from "../../lib/integrations/tripletex/mappers"

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
    // No discount → no discount field.
    expect(firstLine).not.toHaveProperty("discount")

    // Regression guard for the double-discount bug: the unit price must be the
    // BEFORE-discount price (950, not the net 902.5) with the discount passed
    // separately, so Tripletex's unitPrice * count * (1 - discount/100) matches
    // the accepted offer net.
    const secondLine = payload.orderLines[1] as Record<string, number>
    expect(secondLine.unitPriceExcludingVatCurrency).toBe(950)
    expect(secondLine.discount).toBe(5)

    const tripletexTotal = (payload.orderLines as Record<string, number>[]).reduce((sum, line) => {
      const discount = line.discount || 0
      return sum + line.unitPriceExcludingVatCurrency * line.count * (1 - discount / 100)
    }, 0)
    // 10*880 + 8*950*0.95 = 8800 + 7220 = 16020 (== calculateOfferTotals(...).totalNok)
    expect(Math.round(tripletexTotal)).toBe(16020)
  })

  it("omits project when prosjektmodul is not synced", () => {
    const payload = mapOrderFromOffer(
      {
        id: "offer-3",
        title: "Ordre uten prosjekt",
        description: null,
        amount_nok: 8000,
        line_items: [],
      },
      10,
      null
    )

    expect(payload.customer).toEqual({ id: 10 })
    expect(payload).not.toHaveProperty("project")
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

describe("mapProjectOfferFromOffer", () => {
  it("creates a Tripletex project offer for Tilbudsoversikt", () => {
    const payload = mapProjectOfferFromOffer(
      {
        id: "offer-1",
        title: "Bad-renovering",
        description: "Komplett rehab",
        amount_nok: 250000,
        pricing_model: "fixed",
      },
      101,
      55,
      { projectName: "Hovedprosjekt" }
    )

    expect(payload.isOffer).toBe(true)
    expect(payload.isFixedPrice).toBe(true)
    expect(payload.fixedprice).toBe(250000)
    expect(payload.customer).toEqual({ id: 101 })
    expect(payload.projectManager).toEqual({ id: 55 })
    expect(payload.name).toBe("Bad-renovering")
    expect(payload.number).toBe("OFFER")
    expect(payload.externalAccountsNumber).toBe("offer-1")
  })
})

describe("mapTilbudOrderLinesFromOffer", () => {
  it("maps offer lines to Tripletex tilbud order lines", () => {
    const lines = mapTilbudOrderLinesFromOffer(
      {
        id: "offer-1",
        title: "Tilbud",
        description: null,
        amount_nok: 1000,
        line_items: [
          {
            id: "1",
            subproject: "Bad",
            title: "Flis",
            description: "",
            quantity: 5,
            unit: "m2",
            supplier: "",
            unitPriceNok: 400,
            markupPercent: 0,
            discountPercent: 0,
          },
        ],
      },
      999,
      { defaultVatTypeId: 3 }
    )

    expect(lines).toHaveLength(1)
    expect(lines[0].project).toEqual({ id: 999 })
    expect(lines[0].count).toBe(5)
    expect(lines[0].vatType).toEqual({ id: 3 })
  })
})
