import { describe, expect, it } from "vitest"

import {
  describeOfferLineItemChanges,
  diffOfferLineItems,
} from "@/lib/tilbud/offer-line-item-diff"
import type { OfferLineItem } from "@/lib/tilbud/types"

function lineItem(
  overrides: Partial<OfferLineItem> = {}
): OfferLineItem {
  return {
    id: "line-1",
    subproject: "Generelt",
    title: "Arbeid",
    description: "",
    quantity: 1,
    unit: "stk",
    supplier: "",
    unitPriceNok: 1_000,
    markupPercent: 0,
    discountPercent: 0,
    ...overrides,
  }
}

describe("diffOfferLineItems", () => {
  it("finner nye linjer", () => {
    const added = lineItem({ id: "line-2", title: "Materialer" })
    const changes = diffOfferLineItems([lineItem()], [lineItem(), added])

    expect(changes).toEqual([{ type: "added", item: added }])
    expect(describeOfferLineItemChanges(changes)).toEqual([
      "La til «Materialer»",
    ])
  })

  it("finner fjernede linjer", () => {
    const removed = lineItem({ id: "line-2", title: "Rigg" })
    const changes = diffOfferLineItems(
      [lineItem(), removed],
      [lineItem()]
    )

    expect(changes).toEqual([{ type: "removed", item: removed }])
    expect(describeOfferLineItemChanges(changes)).toEqual([
      "Fjernet «Rigg»",
    ])
  })

  it("viser konkrete felt som ble endret", () => {
    const before = lineItem()
    const after = lineItem({
      quantity: 2,
      unitPriceNok: 1_250,
      discountPercent: 10,
    })
    const changes = diffOfferLineItems([before], [after])

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      type: "changed",
      fields: ["quantity", "unitPriceNok", "discountPercent"],
    })
    expect(describeOfferLineItemChanges(changes)).toEqual([
      "Endret «Arbeid»: antall 1 → 2, enhetspris 1 000 kr → 1 250 kr, rabatt 0 % → 10 %",
    ])
  })

  it("ignorerer uendrede linjer", () => {
    const item = lineItem()
    expect(diffOfferLineItems([item], [{ ...item }])).toEqual([])
  })
})
