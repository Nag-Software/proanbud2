import { describe, expect, it } from "vitest"

import {
  buildFikenDraftLines,
  mapInvoiceDraftFromProjectInvoice,
  mapOfferDraftFromOffer,
} from "../../lib/integrations/fiken/mappers"
import {
  DEFAULT_FIKEN_VAT_TYPE,
  NON_VAT_REGISTERED_FIKEN_VAT_TYPE,
  resolveFikenVatType,
} from "../../lib/integrations/fiken/vat"

const offer = {
  id: "offer-1",
  title: "Bad",
  description: null,
  amount_nok: 10000,
  line_items: [
    { title: "Arbeid", quantity: 10, unit: "time", unitPriceNok: 900, markupPercent: 0, discountPercent: 0 },
    { title: "Fliser", quantity: 5, unit: "m2", supplier: "Ahlsell", unitPriceNok: 300, markupPercent: 0, discountPercent: 0 },
  ],
}

// Regresjon: Fiken svarte HTTP 400 «VAT charged when the company is not VAT registered.
// The only VAT type accepted is OUTSIDE.» fordi vi sendte NONE for en ikke-registrert
// bedrift — NONE betyr 0 % på et avgiftspliktig salg og forutsetter registrering.
describe("resolveFikenVatType", () => {
  it("gir HIGH for mva-registrerte bedrifter", () => {
    expect(resolveFikenVatType(true)).toBe("HIGH")
    expect(resolveFikenVatType(true)).toBe(DEFAULT_FIKEN_VAT_TYPE)
  })

  it("gir OUTSIDE — ikke NONE — for bedrifter utenfor mva-registeret", () => {
    expect(resolveFikenVatType(false)).toBe("OUTSIDE")
    expect(resolveFikenVatType(false)).toBe(NON_VAT_REGISTERED_FIKEN_VAT_TYPE)
    expect(resolveFikenVatType(false)).not.toBe("NONE")
  })

  it("lar en eksplisitt default_vat_type overstyre satsen", () => {
    expect(resolveFikenVatType(true, "MEDIUM")).toBe("MEDIUM")
    expect(resolveFikenVatType(false, "EXEMPT")).toBe("EXEMPT")
  })

  it("ignorerer tom/whitespace-override", () => {
    expect(resolveFikenVatType(false, "   ")).toBe("OUTSIDE")
    expect(resolveFikenVatType(true, null)).toBe("HIGH")
  })
})

describe("mva-status styrer inntektskonto, ikke vatType", () => {
  it("mva-registrert: HIGH og 30xx-konti", () => {
    const lines = buildFikenDraftLines(offer, { vatType: "HIGH", vatRegistered: true })
    expect(lines.every((l) => l.vatType === "HIGH")).toBe(true)
    expect(lines.map((l) => l.incomeAccount)).toEqual(["3020", "3000"])
    expect(lines.every((l) => l.incomeAccount!.startsWith("30"))).toBe(true)
  })

  it("ikke mva-registrert: OUTSIDE og 32xx-konti", () => {
    const lines = buildFikenDraftLines(offer, { vatType: "OUTSIDE", vatRegistered: false })
    expect(lines.every((l) => l.vatType === "OUTSIDE")).toBe(true)
    expect(lines.map((l) => l.incomeAccount)).toEqual(["3220", "3200"])
    expect(lines.every((l) => l.incomeAccount!.startsWith("32"))).toBe(true)
  })

  it("KRAV: en eksplisitt vatType endrer ikke hvilken kontogruppe mva-statusen krever", () => {
    // Dette er feilen som ble rettet: OUTSIDE ble utledet som «registrert» via
    // `vatType !== "NONE"`, og ga 30xx-konti til en ikke-registrert bedrift.
    const ikkeRegistrert = buildFikenDraftLines(offer, { vatType: "EXEMPT", vatRegistered: false })
    expect(ikkeRegistrert.every((l) => l.incomeAccount!.startsWith("32"))).toBe(true)
    expect(ikkeRegistrert.every((l) => l.vatType === "EXEMPT")).toBe(true)

    const registrert = buildFikenDraftLines(offer, { vatType: "NONE", vatRegistered: true })
    expect(registrert.every((l) => l.incomeAccount!.startsWith("30"))).toBe(true)
  })

  it("samlelinja (tilbud uten linjer) følger samme regel", () => {
    const tomt = { ...offer, line_items: [] }
    expect(buildFikenDraftLines(tomt, { vatType: "HIGH", vatRegistered: true })[0].incomeAccount).toBe("3020")
    expect(buildFikenDraftLines(tomt, { vatType: "OUTSIDE", vatRegistered: false })[0].incomeAccount).toBe("3220")
  })
})

describe("prosjektfaktura-mapperen", () => {
  const lines = [
    { description: "Arbeid", quantity: 1, unit_price_nok: 50000, income_account_category: "tjeneste" },
    { description: "Materialer", quantity: 1, unit_price_nok: 25658, income_account_category: "vare_videresalg" },
  ]

  it("mva-registrert: HIGH og 30xx", () => {
    const draft = mapInvoiceDraftFromProjectInvoice(lines, 7, { vatType: "HIGH", vatRegistered: true })
    const out = draft.lines as Array<Record<string, unknown>>
    expect(out.map((l) => l.vatType)).toEqual(["HIGH", "HIGH"])
    expect(out.map((l) => l.incomeAccount)).toEqual(["3020", "3000"])
  })

  it("ikke mva-registrert: OUTSIDE og 32xx — den faktiske feilen fra jobb 250", () => {
    const draft = mapInvoiceDraftFromProjectInvoice(lines, 7, { vatType: "OUTSIDE", vatRegistered: false })
    const out = draft.lines as Array<Record<string, unknown>>
    expect(out.map((l) => l.vatType)).toEqual(["OUTSIDE", "OUTSIDE"])
    expect(out.map((l) => l.incomeAccount)).toEqual(["3220", "3200"])
  })

  it("beløp går i øre uavhengig av mva-status", () => {
    const draft = mapInvoiceDraftFromProjectInvoice(lines, 7, { vatType: "OUTSIDE", vatRegistered: false })
    const out = draft.lines as Array<Record<string, unknown>>
    expect(out.map((l) => l.unitPrice)).toEqual([5000000, 2565800])
  })
})

describe("tilbudsmapperen", () => {
  it("sender OUTSIDE og 32xx for ikke-registrert bedrift", () => {
    const draft = mapOfferDraftFromOffer(offer, 7, { vatType: "OUTSIDE", vatRegistered: false })
    const out = draft.lines as Array<Record<string, unknown>>
    expect(out.every((l) => l.vatType === "OUTSIDE")).toBe(true)
    expect(out.every((l) => String(l.incomeAccount).startsWith("32"))).toBe(true)
  })
})
