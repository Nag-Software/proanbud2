import { describe, expect, it } from "vitest"

import { mapOrderFromProjectInvoice } from "@/lib/integrations/tripletex/mappers"

describe("mapOrderFromProjectInvoice", () => {
  const lines = [
    { description: "Riving bad", quantity: 1, unit_price_nok: 24000, amount_nok: 24000, sort_order: 0 },
    { description: "Membran", quantity: 12, unit_price_nok: 850, amount_nok: 10200, sort_order: 1 },
  ]

  it("speiler nøyaktig de valgte linjene", () => {
    const order = mapOrderFromProjectInvoice(lines, 555, 777)

    expect(order.orderLines).toHaveLength(2)
    expect(order.orderLines[0]).toMatchObject({
      description: "Riving bad",
      count: 1,
      unitPriceExcludingVatCurrency: 24000,
    })
    expect(order.orderLines[1]).toMatchObject({ count: 12, unitPriceExcludingVatCurrency: 850 })
    expect(order.customer).toEqual({ id: 555 })
    expect(order.project).toEqual({ id: 777 })
  })

  it("sender ALDRI discount — rabatten ligger allerede i enhetsprisen", () => {
    // Tripletex regner linjetotalen som pris × antall × (1 − discount/100). Sender vi
    // en rabatt her i tillegg, trekkes den to ganger og kunden underfaktureres.
    const order = mapOrderFromProjectInvoice(lines, 1, null)
    for (const line of order.orderLines) {
      expect(line).not.toHaveProperty("discount")
    }
  })

  it("utelater prosjekt når fakturaen ikke har et", () => {
    const order = mapOrderFromProjectInvoice(lines, 1, null)
    expect(order).not.toHaveProperty("project")
  })

  it("regner ut enhetspris fra totalen når den mangler", () => {
    const order = mapOrderFromProjectInvoice(
      [{ description: "Fastpris", quantity: 4, unit_price_nok: null, amount_nok: 8000, sort_order: 0 }],
      1,
      null
    )
    expect(order.orderLines[0].unitPriceExcludingVatCurrency).toBe(2000)
  })

  it("gir tomme beskrivelser en lesbar tekst", () => {
    const order = mapOrderFromProjectInvoice(
      [{ description: "  ", quantity: 1, unit_price_nok: 100, amount_nok: 100, sort_order: 0 }],
      1,
      null
    )
    expect(order.orderLines[0].description).toBe("Utført arbeid")
  })

  it("legger på mva-type og konto når tilkoblingen har standarder", () => {
    const order = mapOrderFromProjectInvoice(lines, 1, null, {
      defaultVatTypeId: 3,
      defaultAccountId: 3000,
    })
    expect(order.orderLines[0]).toMatchObject({ vatType: { id: 3 }, account: { id: 3000 } })
  })

  it("bruker en referanse som ikke røper hvilket system som lagde fakturaen", () => {
    const order = mapOrderFromProjectInvoice(lines, 1, null, { reference: "a1b2c3d4" })
    expect(order.reference).toBe("a1b2c3d4")
    expect(JSON.stringify(order).toLowerCase()).not.toContain("proanbud")
  })
})
