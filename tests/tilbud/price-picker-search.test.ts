import { describe, expect, it } from "vitest"

import { rankCompanyPriceRowsForPicker, type CompanyPriceRow } from "@/lib/tilbud/company-price-utils"

describe("rankCompanyPriceRowsForPicker", () => {
  it("finds products by supplier sku codes like 48x098", () => {
    const rows: CompanyPriceRow[] = [
      {
        product: "Annen vare",
        unit: "stk",
        net_price: 10,
        list_price: 12,
        category: "Diverse",
        supplier_sku: "12345",
      },
      {
        product: "Gipsplate standard",
        unit: "stk",
        net_price: 89,
        list_price: 99,
        category: "Gips",
        supplier_sku: "48x098",
      },
    ]

    const result = rankCompanyPriceRowsForPicker(rows, "48x098", 5)

    expect(result).toHaveLength(1)
    expect(result[0]?.supplier_sku).toBe("48x098")
  })

  it("returns ilike matches even when only product name matches", () => {
    const rows: CompanyPriceRow[] = [
      {
        product: "Produkt 48x098 extra",
        unit: "stk",
        net_price: 50,
        list_price: 60,
        category: null,
      },
    ]

    const result = rankCompanyPriceRowsForPicker(rows, "48x098", 5)

    expect(result).toHaveLength(1)
    expect(result[0]?.product).toContain("48x098")
  })
})
