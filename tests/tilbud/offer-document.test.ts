import { describe, expect, it } from "vitest"

import {
  buildOfferDocumentModel,
  buildOfferDocumentPage,
  buildOfferDocumentSheet,
  buildOfferFooterParts,
  calculateGroupTotal,
  computeValidUntilDate,
  formatDocumentAmount,
  formatDocumentCurrency,
  formatDocumentQuantity,
  formatDocumentUnit,
  formatOfferDate,
  normalizePaymentSchedule,
  type OfferDocumentData,
} from "@/lib/tilbud/offer-document"
import { type OfferLineItem } from "@/lib/tilbud/types"

function makeItem(overrides: Partial<OfferLineItem> = {}): OfferLineItem {
  return {
    id: crypto.randomUUID(),
    subproject: "Generelt",
    title: "Testlinje",
    description: "",
    quantity: 1,
    unit: "stk",
    supplier: "",
    unitPriceNok: 100,
    markupPercent: 0,
    discountPercent: 0,
    ...overrides,
  }
}

function makeData(overrides: Partial<OfferDocumentData> = {}): OfferDocumentData {
  return {
    title: "Testtilbud",
    customer: { name: "Kunde Kundesen" },
    lineItems: [makeItem()],
    company: { id: "c1", name: "Firma AS", orgNumber: "999 999 999" },
    issuedDate: "2026-07-01T09:00:00Z",
    ...overrides,
  }
}

describe("document formatting", () => {
  it("formats money with two decimals (nb-NO)", () => {
    expect(formatDocumentAmount(1234.5)).toBe("1 234,50")
    expect(formatDocumentCurrency(0)).toContain("0,00")
  })

  it("formats quantities without trailing zeros and with comma decimals", () => {
    expect(formatDocumentQuantity(6.5)).toBe("6,5")
    expect(formatDocumentQuantity(320)).toBe("320")
  })

  it("renders m2/m3 units with superscripts", () => {
    expect(formatDocumentUnit("m2")).toBe("m²")
    expect(formatDocumentUnit("m3")).toBe("m³")
    expect(formatDocumentUnit("stk")).toBe("stk")
  })

  it("formats dates as dd.mm.yyyy", () => {
    expect(formatOfferDate("2026-07-01T09:00:00Z")).toBe("01.07.2026")
  })
})

describe("computeValidUntilDate", () => {
  it("prefers the stored quoteValidUntil date", () => {
    const result = computeValidUntilDate("2026-07-01", "2026-07-31", 14)
    expect(formatOfferDate(result)).toBe("31.07.2026")
  })

  it("derives issued date + validity days when no explicit date exists", () => {
    const result = computeValidUntilDate("2026-07-01T00:00:00Z", null, 14)
    expect(formatOfferDate(result)).toBe("15.07.2026")
  })
})

describe("normalizePaymentSchedule", () => {
  it("drops empty and zero-percent entries", () => {
    expect(
      normalizePaymentSchedule([
        { label: "Ved oppstart", percent: 30 },
        { label: "", percent: 50 },
        { label: "Ugyldig", percent: 0 },
      ])
    ).toEqual([{ label: "Ved oppstart", percent: 30, dueDescription: "" }])
  })

  it("handles null/undefined", () => {
    expect(normalizePaymentSchedule(null)).toEqual([])
    expect(normalizePaymentSchedule(undefined)).toEqual([])
  })
})

describe("buildOfferDocumentModel", () => {
  it("hides group scaffolding when everything is in the default bucket", () => {
    const model = buildOfferDocumentModel(makeData())
    expect(model.showGroups).toBe(false)
  })

  it("shows groups when there are multiple subprojects", () => {
    const model = buildOfferDocumentModel(
      makeData({ lineItems: [makeItem({ subproject: "Riving" }), makeItem({ subproject: "Elektro" })] })
    )
    expect(model.showGroups).toBe(true)
  })

  it("computes pre-discount subtotal so totals reconcile", () => {
    const model = buildOfferDocumentModel(
      makeData({
        lineItems: [makeItem({ quantity: 2, unitPriceNok: 100, discountPercent: 10 })],
      })
    )
    expect(model.totals.subtotalNok).toBe(180)
    expect(model.totals.discountNok).toBe(20)
    expect(model.preDiscountSubtotalNok).toBe(200)
    expect(model.vatAmountNok).toBe(45)
    expect(model.totalInclVatNok).toBe(225)
  })
})

describe("calculateGroupTotal", () => {
  it("sums discounted line totals", () => {
    const items = [
      makeItem({ quantity: 2, unitPriceNok: 100 }),
      makeItem({ quantity: 1, unitPriceNok: 50, discountPercent: 10 }),
    ]
    expect(calculateGroupTotal(items)).toBe(245)
  })
})

describe("buildOfferDocumentSheet", () => {
  it("escapes HTML in user-controlled fields", () => {
    const html = buildOfferDocumentSheet(
      makeData({
        title: '<script>alert("x")</script>',
        lineItems: [makeItem({ title: "Linje <b>fet</b>" })],
      })
    )
    expect(html).not.toContain("<script>alert")
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<b>fet</b>")
  })

  it("shows the offer reference and explicit expiry date", () => {
    const html = buildOfferDocumentSheet(makeData({ offerReference: "8F3A21D4", quoteValidUntil: "2026-07-31" }))
    expect(html).toContain("Tilbudsnr. 8F3A21D4")
    expect(html).toContain("Gyldig til: 31.07.2026")
  })

  it("omits the discount column when no line has a discount", () => {
    const html = buildOfferDocumentSheet(makeData())
    expect(html).not.toContain(">Rabatt<")
  })

  it("includes the discount column when a line has a discount", () => {
    const html = buildOfferDocumentSheet(makeData({ lineItems: [makeItem({ discountPercent: 5 })] }))
    expect(html).toContain(">Rabatt<")
  })

  it("renders payment schedule and contract terms when present", () => {
    const html = buildOfferDocumentSheet(
      makeData({
        paymentSchedule: [{ label: "Ved oppstart", percent: 30 }],
        pricingModel: "fixed",
        contractBasis: "ns8407",
      })
    )
    expect(html).toContain("Betalingsplan")
    expect(html).toContain("Ved oppstart")
    expect(html).toContain("Prismodell: Fastpris.")
    expect(html).toContain("Kontraktsgrunnlag: NS 8407.")
  })

  it("hides supplier names when showSupplier is false", () => {
    const html = buildOfferDocumentSheet(
      makeData({ lineItems: [makeItem({ supplier: "Hemmelig Grossist AS" })] }),
      { showSupplier: false }
    )
    expect(html).not.toContain("Hemmelig Grossist AS")
  })

  it("renders blank signature lines when the offer is not digitally accepted", () => {
    const html = buildOfferDocumentSheet(makeData())
    expect(html).toContain("Sted / dato")
    expect(html).toContain("Signatur")
  })

  it("replaces signature lines with the acceptance evidence block after digital acceptance", () => {
    const html = buildOfferDocumentSheet(
      makeData({
        acceptance: {
          name: "Kari Nordmann",
          email: "kari@example.com",
          acceptedAt: "2026-07-02T10:30:00Z",
          method: "email_otp",
          documentSha256: "abc123def456",
        },
      })
    )
    expect(html).toContain("akseptert digitalt")
    expect(html).toContain("Kari Nordmann")
    expect(html).toContain("kari@example.com")
    expect(html).toContain("abc123def456")
    expect(html).not.toContain("Sted / dato")
  })
})

describe("buildOfferDocumentPage", () => {
  it("uses css page margins for browser printing by default", () => {
    const html = buildOfferDocumentPage(makeData())
    expect(html).toContain("@page { size: A4; margin: 10mm 0 14mm; }")
  })

  it("zeroes css margins and hides the footer strip in external (Puppeteer) mode", () => {
    const html = buildOfferDocumentPage(makeData(), { printMarginMode: "external" })
    expect(html).toContain("@page { size: A4; margin: 0; }")
    expect(html).toContain(".offer-footer { display: none; }")
  })

  it("injects the provided font-face css", () => {
    const html = buildOfferDocumentPage(makeData(), { fontFaceCss: "@font-face { font-family: X; }" })
    expect(html).toContain("@font-face { font-family: X; }")
  })
})

describe("buildOfferFooterParts", () => {
  it("joins available company identity fields", () => {
    expect(
      buildOfferFooterParts({
        id: "c1",
        name: "Firma AS",
        orgNumber: "999 999 999",
        phone: "400 00 000",
        email: null,
        website: null,
      })
    ).toEqual(["Firma AS", "Org.nr. 999 999 999", "400 00 000"])
  })
})
