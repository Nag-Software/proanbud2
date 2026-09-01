import { describe, expect, it } from "vitest"

import { validateSelection, type BillableItem } from "../../lib/fakturering/billable"

function item(overrides: Partial<BillableItem> = {}): BillableItem {
  return {
    sourceType: "offer",
    sourceId: "offer-1",
    title: "Baderom",
    description: null,
    totalNok: 100000,
    invoicedNok: 0,
    remainingNok: 100000,
    incomeAccountCategory: "tjeneste",
    ...overrides,
  }
}

describe("validateSelection — vernet mot dobbeltfakturering", () => {
  it("godtar en sluttfaktura på hele gjenstående", () => {
    expect(validateSelection([{ sourceType: "offer", sourceId: "offer-1", amountNok: 100000 }], [item()])).toEqual({
      ok: true,
    })
  })

  it("godtar a-konto på en del av beløpet", () => {
    expect(validateSelection([{ sourceType: "offer", sourceId: "offer-1", amountNok: 40000 }], [item()])).toEqual({
      ok: true,
    })
  })

  it("AVVISER beløp over gjenstående — samme arbeid kan ikke faktureres to ganger", () => {
    const billable = [item({ invoicedNok: 40000, remainingNok: 60000 })]
    expect(validateSelection([{ sourceType: "offer", sourceId: "offer-1", amountNok: 60001 }], billable).ok).toBe(false)
  })

  it("AVVISER at samme kilde faktureres to ganger i ETT utvalg", () => {
    const result = validateSelection(
      [
        { sourceType: "offer", sourceId: "offer-1", amountNok: 60000 },
        { sourceType: "offer", sourceId: "offer-1", amountNok: 60000 },
      ],
      [item({ remainingNok: 100000 })]
    )
    expect(result.ok).toBe(false)
  })

  it("tåler ett øre avrundingsslark, men ikke mer", () => {
    const billable = [item({ remainingNok: 1000 })]
    expect(validateSelection([{ sourceType: "offer", sourceId: "offer-1", amountNok: 1000.01 }], billable).ok).toBe(true)
    expect(validateSelection([{ sourceType: "offer", sourceId: "offer-1", amountNok: 1000.5 }], billable).ok).toBe(false)
  })

  it("AVVISER en kilde som ikke hører til prosjektet", () => {
    expect(
      validateSelection([{ sourceType: "change_order", sourceId: "fremmed-id", amountNok: 100 }], [item()]).ok
    ).toBe(false)
  })

  it("AVVISER tomt utvalg og ikke-positive beløp", () => {
    expect(validateSelection([], [item()]).ok).toBe(false)
    expect(validateSelection([{ sourceType: "offer", sourceId: "offer-1", amountNok: 0 }], [item()]).ok).toBe(false)
    expect(validateSelection([{ sourceType: "offer", sourceId: "offer-1", amountNok: -500 }], [item()]).ok).toBe(false)
  })

  it("skiller kilder med samme id men ulik type", () => {
    const billable = [
      item({ sourceType: "offer", sourceId: "delt-id", remainingNok: 1000 }),
      item({ sourceType: "change_order", sourceId: "delt-id", remainingNok: 500, title: "Tillegg" }),
    ]
    expect(
      validateSelection(
        [
          { sourceType: "offer", sourceId: "delt-id", amountNok: 1000 },
          { sourceType: "change_order", sourceId: "delt-id", amountNok: 500 },
        ],
        billable
      ).ok
    ).toBe(true)
    expect(validateSelection([{ sourceType: "change_order", sourceId: "delt-id", amountNok: 900 }], billable).ok).toBe(
      false
    )
  })
})
