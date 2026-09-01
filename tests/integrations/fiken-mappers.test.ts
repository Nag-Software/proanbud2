import { describe, expect, it } from "vitest"

import {
  buildFikenDraftLines,
  mapCustomerToFiken,
  mapInvoiceDraftFromOffer,
  mapInvoiceDraftFromProjectInvoice,
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
      { vatType: "HIGH", vatRegistered: true, incomeAccount: "3000" }
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
      { vatType: "HIGH", vatRegistered: true }
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
      { vatType: "HIGH", vatRegistered: true }
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
    const draft = mapOfferDraftFromOffer(offer, 7, { projectId: 3, vatType: "HIGH", vatRegistered: true })
    expect(draft.type).toBe("offer")
    expect(draft.customerId).toBe(7)
    expect(draft.daysUntilDueDate).toBe(14)
    expect(draft.projectId).toBe(3)
    expect(Array.isArray(draft.lines)).toBe(true)
  })

  it("invoice draft sets type=invoice, issueDate and a due-date offset", () => {
    const draft = mapInvoiceDraftFromOffer(offer, 7, { vatType: "HIGH", vatRegistered: true, daysUntilDueDate: 30 })
    expect(draft.type).toBe("invoice")
    expect(draft.customerId).toBe(7)
    expect(typeof draft.issueDate).toBe("string")
    expect(draft.daysUntilDueDate).toBe(30)
    // `cash` hører til invoiceRequest/draftRequest, IKKE invoiceishDraftRequest.
    // Fiken dokumenterer 400 på ukjente felt, så det skal ikke sendes på et utkast.
    expect("cash" in draft).toBe(false)
  })
})

// Regression: Fiken answered HTTP 400 "incomeAccount is required for free-text lines
// (lines without a productId)" on every real tilbud, because incomeAccount was only set
// when the connection had an explicit override — and it is NULL by default.
describe("buildFikenDraftLines — incomeAccount is mandatory", () => {
  const offerWithLines = {
    id: "offer-1",
    title: "Bad",
    description: null,
    amount_nok: 50000,
    line_items: [
      { title: "Flislegging", quantity: 2, unitPriceNok: 1000, markupPercent: 0, discountPercent: 0 },
    ],
  }

  const offerWithoutLines = {
    id: "offer-2",
    title: "Totalpris",
    description: null,
    amount_nok: 20000,
    line_items: [],
  }

  // Invarianten som betyr noe er at feltet ALDRI mangler. Hvilken konto det blir
  // avgjøres av linjas kategori (se income-accounts.test.ts) — her sjekker vi bare at
  // en konto faktisk settes, uten å låse oss til én bestemt kode.
  it("setter alltid en konto, også uten konfigurasjon", () => {
    const lines = buildFikenDraftLines(offerWithLines, { vatType: "HIGH", vatRegistered: true })
    expect(lines).toHaveLength(1)
    expect(lines[0].incomeAccount).toMatch(/^3\d{3}$/)
  })

  it("setter en konto på samlelinja også", () => {
    // Samlelinja har ingen vare/tjeneste-identitet å gjette fra, så den bruker
    // standardkategorien «tjeneste» — men fortsatt mva-riktig konto.
    expect(buildFikenDraftLines(offerWithoutLines, { vatType: "HIGH", vatRegistered: true })[0].incomeAccount).toBe("3020")
    expect(buildFikenDraftLines(offerWithoutLines, { vatType: "OUTSIDE", vatRegistered: false })[0].incomeAccount).toBe("3220")
  })

  it("prefers the connection override when present", () => {
    const lines = buildFikenDraftLines(offerWithLines, { vatType: "HIGH", vatRegistered: true, incomeAccount: "3020" })
    expect(lines[0].incomeAccount).toBe("3020")
  })

  it("treats a blank/whitespace override as absent rather than sending an empty account", () => {
    for (const blank of [null, undefined, "", "   "]) {
      const lines = buildFikenDraftLines(offerWithLines, { vatType: "HIGH", vatRegistered: true, incomeAccount: blank })
      expect(lines[0].incomeAccount).toMatch(/^3\d{3}$/)
    }
  })
})

describe("buildFikenDraftLines — konto per linje", () => {
  const offer = {
    id: "offer-3",
    title: "Bad",
    description: null,
    amount_nok: 0,
    line_items: [
      { title: "Arbeid", quantity: 10, unit: "time", unitPriceNok: 900, markupPercent: 0, discountPercent: 0 },
      { title: "Fliser", quantity: 20, unit: "m2", supplier: "Ahlsell", unitPriceNok: 300, markupPercent: 0, discountPercent: 0 },
      { title: "Spesial", quantity: 1, unit: "stk", unitPriceNok: 5000, markupPercent: 0, discountPercent: 0, incomeAccountCategory: "vare_egenprodusert" },
    ],
  }

  it("gir hver linje konto ut fra kategori når bedriften er mva-registrert", () => {
    const lines = buildFikenDraftLines(offer, { vatType: "HIGH", vatRegistered: true })
    expect(lines.map((l) => l.incomeAccount)).toEqual(["3020", "3000", "3010"])
  })

  it("bytter til «unntatt for mva»-kontoene når vatType er NONE", () => {
    const lines = buildFikenDraftLines(offer, { vatType: "OUTSIDE", vatRegistered: false })
    expect(lines.map((l) => l.incomeAccount)).toEqual(["3220", "3200", "3210"])
  })

  it("lar en eksplisitt konto på tilkoblingen overstyre alle linjer", () => {
    const lines = buildFikenDraftLines(offer, { vatType: "HIGH", vatRegistered: true, incomeAccount: "3900" })
    expect(lines.map((l) => l.incomeAccount)).toEqual(["3900", "3900", "3900"])
  })

  it("kutter beskrivelser til Fikens 200-tegnsgrense", () => {
    const lines = buildFikenDraftLines(
      { ...offer, line_items: [{ title: "A".repeat(400), quantity: 1, unitPriceNok: 10, markupPercent: 0, discountPercent: 0 }] },
      { vatType: "HIGH", vatRegistered: true }
    )
    expect(lines[0].description?.length ?? 0).toBeLessThanOrEqual(200)
    expect(lines[0].description?.length).toBeGreaterThan(100)
  })
})

// Regresjon: vi prøvde BEGGE bankkontofeltene på fakturautkast, og Fiken avviste begge.
//   bankAccountCode → finnes ikke i draft-skjemaet; ignorert stille → konto ble null
//   paymentAccount  → «Draft of type INVOICE cannot have a payment account specified.
//                      A payment account is only allowed for drafts of type CASH_INVOICE.»
// En vanlig faktura henter kontoen fra firmaets Fiken-innstillinger. Send ingenting.
describe("bankkonto på fakturautkast — kun bankAccountNumber", () => {
  const offer = { id: "o1", title: "Bad", description: null, amount_nok: 1000, line_items: [] }
  const lines = [{ description: "Arbeid", quantity: 1, unit_price_nok: 1000, income_account_category: "tjeneste" }]

  it("sender kontoNUMMERET, ikke kontokoden", () => {
    const draft = mapInvoiceDraftFromProjectInvoice(lines, 7, {
      vatType: "HIGH",
      vatRegistered: true,
      bankAccountNumber: "15035646830",
    })
    expect(draft.bankAccountNumber).toBe("15035646830")
    // De to andre feltene ble avvist av Fiken: bankAccountCode finnes ikke i
    // draft-skjemaet, og paymentAccount er kun for CASH_INVOICE.
    expect("bankAccountCode" in draft).toBe(false)
    expect("paymentAccount" in draft).toBe(false)
  })

  it("gjelder også faktura fra tilbud", () => {
    const draft = mapInvoiceDraftFromOffer(offer, 7, {
      vatType: "HIGH",
      vatRegistered: true,
      bankAccountNumber: "15035646830",
    })
    expect(draft.bankAccountNumber).toBe("15035646830")
  })

  it("TILBUD skal aldri ha bankkonto — det finnes ingen betaling på et tilbud", () => {
    const draft = mapOfferDraftFromOffer(offer, 7, { vatType: "HIGH", vatRegistered: true })
    expect("bankAccountNumber" in draft).toBe(false)
  })

  it("utelater feltet når ingen konto er valgt", () => {
    const draft = mapInvoiceDraftFromProjectInvoice(lines, 7, { vatType: "HIGH", vatRegistered: true })
    expect("bankAccountNumber" in draft).toBe(false)
  })
})

// Funnet ved grundig lesing av swagger: `uuid` på utkastet kan slås opp igjen via
// GET /invoices?invoiceDraftUuid=. Det er det som gjør en tvetydig ferdigstilling
// gjenopprettbar i stedet for et dead-letter.
describe("prosjektfaktura — felter fra spec-gjennomgangen", () => {
  const lines = [{ description: "Arbeid", quantity: 1, unit_price_nok: 1000, income_account_category: "tjeneste" }]

  it("sender draft-uuid, kundemelding og vår referanse", () => {
    const draft = mapInvoiceDraftFromProjectInvoice(lines, 7, {
      vatType: "HIGH",
      vatRegistered: true,
      draftUuid: "8286b67f-6c2c-4590-b174-b5279e3bc6b4",
      invoiceText: "Faktura for utført arbeid t.o.m. uke 36",
      ourReference: "a00c31c1-b802-44e1-82b1-b61d211ed47f",
    })
    expect(draft.uuid).toBe("8286b67f-6c2c-4590-b174-b5279e3bc6b4")
    expect(draft.invoiceText).toBe("Faktura for utført arbeid t.o.m. uke 36")
    // Vår ref er prosjektets id — kunden skal ikke se hvilket system som lagde
    // fakturaen, og referansen skal peke på prosjektet, ikke på fakturaraden.
    expect(draft.ourReference).toBe("a00c31c1-b802-44e1-82b1-b61d211ed47f")
    expect(String(draft.ourReference)).not.toMatch(/proanbud/i)
  })

  it("utelater feltene når de ikke er satt — Fiken gir 400 på ukjente/tomme felt", () => {
    const draft = mapInvoiceDraftFromProjectInvoice(lines, 7, { vatType: "HIGH", vatRegistered: true })
    expect("uuid" in draft).toBe(false)
    expect("invoiceText" in draft).toBe(false)
    expect("ourReference" in draft).toBe(false)
  })

  it("behandler blank melding som fraværende", () => {
    const draft = mapInvoiceDraftFromProjectInvoice(lines, 7, {
      vatType: "HIGH",
      vatRegistered: true,
      invoiceText: "   ",
    })
    expect("invoiceText" in draft).toBe(false)
  })
})
