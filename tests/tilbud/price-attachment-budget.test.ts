import { describe, expect, it } from "vitest"

import {
  buildAiPriceSelectionContext,
  PRICE_ATTACHMENT_CONTENT_BUDGET_CHARS,
  type CompanyPriceRow,
} from "@/lib/tilbud/company-price-utils"

type RowWithFile = CompanyPriceRow & { file_id?: string | null }

function makeRow(overrides: Partial<RowWithFile> = {}): RowWithFile {
  return {
    product: "Gipsplate Standard 13x1200x2400",
    unit: "stk",
    net_price: 129,
    list_price: 159,
    category: "Plater",
    nobb: "12345678",
    supplier_sku: "SKU-1",
    product_group_code: "PG100",
    file_id: "file-1",
    ...overrides,
  }
}

const FILE_META = { id: "file-1", supplier_name: "Byggmakker", original_filename: "priser.xlsx", row_count: null }

describe("buildAiPriceSelectionContext budsjett", () => {
  it("beholder alle rader når innholdet er innenfor budsjettet", () => {
    const rows = Array.from({ length: 50 }, (_, index) => makeRow({ product: `Produkt ${index}` }))

    const result = buildAiPriceSelectionContext({ files: [FILE_META], rows, query: "nytt bad" })

    expect(result.attachments).toHaveLength(1)
    expect(result.attachments[0].rowCount).toBe(50)
    expect(result.attachments[0].totalRowCount).toBe(50)
    expect(result.attachments[0].content.split("\n")).toHaveLength(51) // header + 50 rader
  })

  it("kutter til budsjett og prioriterer relevante rader for store prisfiler", () => {
    // Simulerer den reelle kundefeilen: titusenvis av rader → millioner av tegn.
    const noiseRows = Array.from({ length: 30_000 }, (_, index) =>
      makeRow({ product: `Takrenne aluminium variant ${index}`, category: "Tak og beslag" })
    )
    const relevantRows = Array.from({ length: 20 }, (_, index) =>
      makeRow({ product: `Våtromsmembran flislim bad ${index}`, category: "Våtrom" })
    )
    const rows = [...noiseRows, ...relevantRows]

    const result = buildAiPriceSelectionContext({
      files: [FILE_META],
      rows,
      query: "Totalrenovering av bad med membran og flis",
    })

    expect(result.attachments).toHaveLength(1)
    const attachment = result.attachments[0]

    expect(attachment.totalRowCount).toBe(30_020)
    expect(attachment.rowCount).toBeLessThan(30_020)
    expect(attachment.content.length).toBeLessThanOrEqual(PRICE_ATTACHMENT_CONTENT_BUDGET_CHARS)

    // Alle de relevante våtromsradene skal være med i utvalget.
    for (const row of relevantRows) {
      expect(attachment.content).toContain(row.product as string)
    }

    // allCompanyPrices (brukes til matching etter generering) beholder alt.
    expect(result.allCompanyPrices).toHaveLength(30_020)
  })

  it("fordeler budsjettet på tvers av flere filer", () => {
    const files = [
      { id: "file-1", supplier_name: "Byggmakker", original_filename: "a.xlsx", row_count: null },
      { id: "file-2", supplier_name: "Maxbo", original_filename: "b.xlsx", row_count: null },
    ]
    const rows = [
      ...Array.from({ length: 20_000 }, (_, index) => makeRow({ product: `Produkt A ${index}`, file_id: "file-1" })),
      ...Array.from({ length: 20_000 }, (_, index) => makeRow({ product: `Produkt B ${index}`, file_id: "file-2" })),
    ]

    const result = buildAiPriceSelectionContext({ files, rows, query: "bad" })

    expect(result.attachments).toHaveLength(2)
    const totalContentChars = result.attachments.reduce((sum, attachment) => sum + attachment.content.length, 0)
    expect(totalContentChars).toBeLessThanOrEqual(PRICE_ATTACHMENT_CONTENT_BUDGET_CHARS)

    // Begge filer skal være representert med et vesentlig antall rader.
    for (const attachment of result.attachments) {
      expect(attachment.rowCount).toBeGreaterThan(100)
      expect(attachment.totalRowCount).toBe(20_000)
    }
  })

  it("kan kalles uten query og kutter da i original rekkefølge", () => {
    const rows = Array.from({ length: 30_000 }, (_, index) => makeRow({ product: `Produkt ${index}` }))

    const result = buildAiPriceSelectionContext({ files: [FILE_META], rows })

    const attachment = result.attachments[0]
    expect(attachment.content.length).toBeLessThanOrEqual(PRICE_ATTACHMENT_CONTENT_BUDGET_CHARS)
    expect(attachment.content).toContain("Produkt 0")
    expect(attachment.rowCount).toBeLessThan(30_000)
  })
})
