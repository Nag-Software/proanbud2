import { describe, expect, it } from "vitest"

import {
  buildPriceRowIndex,
  resolvePriceRowReferences,
  runPriceLookup,
  type GeneratedLineItem,
} from "@/lib/tilbud/price-lookup"
import type { CompanyPriceRow } from "@/lib/tilbud/company-price-utils"

function row(overrides: Partial<CompanyPriceRow> = {}): CompanyPriceRow {
  return {
    id: "row-1",
    product: "Gipsplate 13mm 1200x2400",
    unit: "stk",
    net_price: 129,
    list_price: 159,
    category: "Gips",
    nobb: "12345678",
    supplier_sku: "SKU-1",
    supplier_name: "Optimera",
    ...overrides,
  }
}

function item(overrides: Partial<GeneratedLineItem> = {}): GeneratedLineItem {
  return {
    id: "line-1",
    subproject: "Vegger",
    title: "Gipsplate",
    description: "",
    quantity: 20,
    unit: "stk",
    supplier: "",
    unitPriceNok: 89,
    markupPercent: 15,
    discountPercent: 0,
    ...overrides,
  }
}

describe("buildPriceRowIndex", () => {
  it("søk og oppslag deler nøkler, så radId-en modellen får kan slås opp igjen", () => {
    const index = buildPriceRowIndex([row(), row({ id: "row-2", product: "Membran våtrom" })])
    const hits = index.search("gipsplate 13mm", 5)

    expect(hits.length).toBeGreaterThan(0)
    const found = index.get(hits[0]!.radId)
    expect(found?.product).toBe(hits[0]!.produkt)
  })

  it("gir rader uten id en stabil posisjonsnøkkel", () => {
    const index = buildPriceRowIndex([row({ id: null })])
    const hits = index.search("gipsplate", 5)

    expect(hits[0]?.radId).toBe("rad-0")
    expect(index.get("rad-0")?.product).toContain("Gipsplate")
  })
})

describe("runPriceLookup", () => {
  it("sier fra når bedriften ikke har prisfiler i det hele tatt", () => {
    const result = runPriceLookup(buildPriceRowIndex([]), { sporring: "gips" })
    expect(result.treff).toEqual([])
    expect(result.merknad).toContain("ingen prisfiler")
  })

  it("ber modellen søke bredere ved null treff", () => {
    const result = runPriceLookup(buildPriceRowIndex([row()]), { sporring: "kvantefysikk" })
    expect(result.treff).toEqual([])
    expect(result.merknad).toContain("bredere")
  })

  it("respekterer taket på antall treff", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ id: `row-${i}` }))
    expect(runPriceLookup(buildPriceRowIndex(rows), { sporring: "gipsplate", maksTreff: 3 }).treff).toHaveLength(3)
    expect(
      runPriceLookup(buildPriceRowIndex(rows), { sporring: "gipsplate", maksTreff: 999 }).treff.length
    ).toBeLessThanOrEqual(25)
  })
})

describe("resolvePriceRowReferences", () => {
  it("erstatter KI-ens tall med prisen på raden den valgte", () => {
    const index = buildPriceRowIndex([row()])
    const { lineItems, warnings } = resolvePriceRowReferences([item({ prisRadId: "row-1" })], index)

    expect(lineItems[0]?.unitPriceNok).toBe(129)
    expect(lineItems[0]?.priceSource).toBe("prisfil")
    expect(lineItems[0]?.supplier).toBe("Optimera")
    expect(lineItems[0]?.nobb).toBe("12345678")
    expect(warnings.some((w) => w.includes("hentet fra prisfila"))).toBe(true)
  })

  it("fjerner den transiente prisRadId fra den lagrede linjen", () => {
    const index = buildPriceRowIndex([row()])
    const { lineItems } = resolvePriceRowReferences([item({ prisRadId: "row-1" })], index)

    expect("prisRadId" in (lineItems[0] as object)).toBe(false)
  })

  it("merker linjen som anslag når radId ikke finnes", () => {
    const index = buildPriceRowIndex([row()])
    const { lineItems, warnings } = resolvePriceRowReferences([item({ prisRadId: "finnes-ikke" })], index)

    expect(lineItems[0]?.unitPriceNok).toBe(89)
    expect(lineItems[0]?.priceSource).toBe("anslag")
    expect(warnings.some((w) => w.includes("Fant ikke prisraden"))).toBe(true)
  })

  it("merker linjen som anslag når raden mangler pris", () => {
    const index = buildPriceRowIndex([row({ net_price: null, list_price: null })])
    const { lineItems } = resolvePriceRowReferences([item({ prisRadId: "row-1" })], index)

    expect(lineItems[0]?.priceSource).toBe("anslag")
  })

  it("lar linjer uten radreferanse gå urørt videre", () => {
    const index = buildPriceRowIndex([row()])
    const { lineItems, warnings } = resolvePriceRowReferences([item()], index)

    expect(lineItems[0]?.unitPriceNok).toBe(89)
    expect(lineItems[0]?.priceSource).toBeUndefined()
    expect(warnings).toEqual([])
  })
})
