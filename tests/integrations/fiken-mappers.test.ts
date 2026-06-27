import { describe, expect, it } from "vitest"

import {
  buildFikenDraftLines,
  mapCustomerToFiken,
  mapInvoiceDraftFromOffer,
  mapOfferDraftFromOffer,
  mapProjectToFiken,
  toFikenNetUnitPriceOre,
} from "../../lib/integrations/fiken/mappers"
import { mapVatPercentToFikenVatType } from "../../lib/integrations/fiken/vat"

describe("mapVatPercentToFikenVatType", () => {
  it("maps Norwegian VAT percentages to the Fiken enum", () => {
    expect(mapVatPercentToFikenVatType(25)).toBe("HIGH")
    expect(mapVatPercentToFikenVatType(15)).toBe("MEDIUM")
    expect(mapVatPercentToFikenVatType(12)).toBe("LOW")
    expect(mapVatPercentToFikenVatType(0)).toBe("NONE")
    expect(mapVatPercentToFikenVatType(null)).toBe("HIGH") // default
  })
})

describe("toFikenNetUnitPriceOre", () => {
  it("converts a NET ex-VAT NOK price to integer øre (Fiken derives VAT from vatType)", () => {
    // Spec: invoiceishDraftLine.unitPrice = NET price per unit in cents.
    expect(toFikenNetUnitPriceOre(1000)).toBe(100000)
    expect(toFikenNetUnitPriceOre(3000)).toBe(300000)
  })

  it("rounds to the nearest øre", () => {
    expect(toFikenNetUnitPriceOre(99.99)).toBe(9999)
    expect(toFikenNetUnitPriceOre(123.455)).toBe(12346)
  })
})

describe("buildFikenDraftLines", () => {
  it("maps line items with markup-before-discount and discount sent separately", () => {
    const lines = buildFikenDraftLines(
      {
        id: "offer-1",
        title: "Bad",
        description: null,
        amount_nok: 50000,
        line_items: [
          {
            id: "1",
            subproject: "Bad",
            title: "Flislegging",
            description: "Gulv",
            quantity: 10,
            unit: "m2",
            supplier: "Byggmakker",
            unitPriceNok: 800,
            markupPercent: 10, // → 880 ex VAT
            discountPercent: 15, // sent as discount, NOT folded into unitPrice
          },
        ],
      },
      { vatType: "HIGH", incomeAccount: "3000" }
    )

    expect(lines).toHaveLength(1)
    // 800 * 1.10 markup = 880 NET ex VAT = 88000 øre (discount NOT folded into unitPrice)
    expect(lines[0].unitPrice).toBe(88000)
    expect(lines[0].quantity).toBe(10)
    expect(lines[0].vatType).toBe("HIGH")
    expect(lines[0].discount).toBe(15)
    expect(lines[0].incomeAccount).toBe("3000")
    expect(lines[0].description).toContain("Flislegging")
  })

  it("falls back to a single summary line when there are no line items", () => {
    const lines = buildFikenDraftLines(
      { id: "offer-2", title: "Totalpris", description: null, amount_nok: 20000, line_items: [] },
      { vatType: "HIGH" }
    )
    expect(lines).toHaveLength(1)
    expect(lines[0].unitPrice).toBe(toFikenNetUnitPriceOre(20000))
    expect(lines[0].quantity).toBe(1)
  })

  it("omits zero discounts", () => {
    const lines = buildFikenDraftLines(
      {
        id: "offer-3",
        title: "X",
        description: null,
        amount_nok: 0,
        line_items: [
          {
            id: "1",
            subproject: "Generelt",
            title: "Arbeid",
            description: "",
            quantity: 1,
            unit: "stk",
            supplier: "",
            unitPriceNok: 500,
            markupPercent: 0,
            discountPercent: 0,
          },
        ],
      },
      { vatType: "HIGH" }
    )
    expect(lines[0].discount).toBeUndefined()
  })
})

describe("mapCustomerToFiken", () => {
  it("flags customer=true and only includes a full address", () => {
    const payload = mapCustomerToFiken({
      name: "Kari Nordmann",
      email: "kari@example.no",
      phone: "99999999",
      org_number: "123456789",
      address: "Storgata 1",
      postal_code: "0001",
      city: "Oslo",
    })
    expect(payload.name).toBe("Kari Nordmann")
    expect(payload.customer).toBe(true)
    expect(payload.organizationNumber).toBe("123456789")
    expect(payload.address).toEqual({
      streetAddress: "Storgata 1",
      postCode: "0001",
      city: "Oslo",
      country: "Norway",
    })
  })

  it("omits the address object when incomplete (Fiken requires all subfields)", () => {
    const payload = mapCustomerToFiken({
      name: "Ola",
      email: null,
      phone: null,
      org_number: null,
      address: "Storgata 1",
      postal_code: null,
      city: null,
    })
    expect(payload.address).toBeUndefined()
  })
})

describe("mapProjectToFiken", () => {
  it("requires number+name+startDate and maps completed", () => {
    const payload = mapProjectToFiken(
      { name: "Hyttebygg", status: "completed", description: "Tømring", start_date: "2026-01-01", end_date: null },
      { number: "PRJ-123", contactId: 42, startDate: "2026-01-01" }
    )
    expect(payload.name).toBe("Hyttebygg")
    expect(payload.number).toBe("PRJ-123")
    expect(payload.startDate).toBe("2026-01-01")
    expect(payload.contactId).toBe(42)
    expect(payload.completed).toBe(true)
  })
})

describe("draft request mappers", () => {
  const offer = { id: "offer-9", title: "Jobb", description: null, amount_nok: 1000, line_items: [] }

  it("offer draft carries required type, customerId, daysUntilDueDate, projectId and lines", () => {
    const draft = mapOfferDraftFromOffer(offer, 7, { projectId: 3, vatType: "HIGH" })
    expect(draft.type).toBe("offer")
    expect(draft.customerId).toBe(7)
    expect(draft.daysUntilDueDate).toBe(14)
    expect(draft.projectId).toBe(3)
    expect(Array.isArray(draft.lines)).toBe(true)
  })

  it("invoice draft sets type=invoice, issueDate and a due-date offset", () => {
    const draft = mapInvoiceDraftFromOffer(offer, 7, { vatType: "HIGH", daysUntilDueDate: 30 })
    expect(draft.type).toBe("invoice")
    expect(draft.customerId).toBe(7)
    expect(typeof draft.issueDate).toBe("string")
    expect(draft.daysUntilDueDate).toBe(30)
    expect(draft.cash).toBe(false)
  })
})
