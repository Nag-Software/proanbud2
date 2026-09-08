import { describe, expect, it } from "vitest"

import { buildOfferDocumentModel, getOfferDocumentTotals } from "../../lib/tilbud/offer-document"
import type { OfferLineItem } from "../../lib/tilbud/types"

const lineItems: OfferLineItem[] = [
  {
    title: "Flislegging",
    description: "",
    subproject: "Generelt",
    quantity: 10,
    unit: "stk",
    unitPriceNok: 1000,
    markupPercent: 0,
    discountPercent: 0,
    supplier: "",
    supplierSku: "",
    supplierUrl: "",
  } as OfferLineItem,
]

describe("mva-pliktig vs ikke mva-pliktig", () => {
  it("legger på 25 % når bedriften er mva-registrert", () => {
    const { totals, vatAmountNok, totalInclVatNok } = getOfferDocumentTotals(lineItems, true)
    expect(totals.subtotalNok).toBe(10000)
    expect(vatAmountNok).toBe(2500)
    expect(totalInclVatNok).toBe(12500)
  })

  it("legger IKKE på mva når bedriften ikke er registrert", () => {
    const { totals, vatAmountNok, totalInclVatNok } = getOfferDocumentTotals(lineItems, false)
    expect(totals.subtotalNok).toBe(10000)
    expect(vatAmountNok).toBe(0)
    // Totalen må være lik nettosummen — ikke nettosum + 25 %.
    expect(totalInclVatNok).toBe(10000)
  })

  it("beholder dagens oppførsel (mva på) når flagget ikke sendes", () => {
    expect(getOfferDocumentTotals(lineItems).totalInclVatNok).toBe(12500)
  })

  it("dokumentmodellen leser mva-status fra bedriften", () => {
    const base = { title: "Tilbud", customer: { name: "Kunde AS" }, lineItems }

    const registrert = buildOfferDocumentModel({
      ...base,
      company: { id: "c1", name: "Bygg AS", orgNumber: null, vatRegistered: true },
    } as never)
    expect(registrert.vatRegistered).toBe(true)
    expect(registrert.totalInclVatNok).toBe(12500)

    const ikkeRegistrert = buildOfferDocumentModel({
      ...base,
      company: { id: "c1", name: "Bygg AS", orgNumber: null, vatRegistered: false },
    } as never)
    expect(ikkeRegistrert.vatRegistered).toBe(false)
    expect(ikkeRegistrert.totalInclVatNok).toBe(10000)
  })

  it("mangler bedriften flagget, behandles den som mva-registrert", () => {
    const m = buildOfferDocumentModel({
      title: "Tilbud",
      customer: { name: "Kunde AS" },
      lineItems,
      company: { id: "c1", name: "Bygg AS", orgNumber: null },
    } as never)
    expect(m.vatRegistered).toBe(true)
  })
})
