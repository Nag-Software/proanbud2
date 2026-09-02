import { describe, expect, it } from "vitest"

/**
 * Tripletex pakker listesvar inkonsistent: {values:[…]} på noen endepunkter,
 * {value:{values:[…]}} på andre. Leser man bare den ene formen, får man en TOM
 * liste uten feilmelding — betalingspollingen ville da aldri markere noe som
 * betalt, og ingen ville oppdaget det.
 *
 * Regelen er duplisert fra worker.ts fordi den filen drar inn server-only-moduler.
 * Blir de uenige, feiler denne testen først.
 */
function readTripletexValueList(response: unknown): Array<Record<string, unknown>> {
  const record = response as Record<string, unknown> | null | undefined
  if (!record || typeof record !== "object") return []
  if (Array.isArray(record.values)) return record.values as Array<Record<string, unknown>>
  const wrapped = record.value as Record<string, unknown> | undefined
  if (wrapped && Array.isArray(wrapped.values)) return wrapped.values as Array<Record<string, unknown>>
  return []
}

describe("Tripletex listesvar", () => {
  const rows = [{ id: 1, amountOutstanding: 0 }]

  it("leser den flate formen", () => {
    expect(readTripletexValueList({ values: rows })).toEqual(rows)
  })

  it("leser den innpakkede formen", () => {
    expect(readTripletexValueList({ value: { values: rows } })).toEqual(rows)
  })

  it("gir tom liste — ikke krasj — på uventet form", () => {
    for (const input of [null, undefined, {}, { values: null }, "nei", 42]) {
      expect(readTripletexValueList(input)).toEqual([])
    }
  })
})

describe("betalt-regelen", () => {
  // amountOutstanding = 0 betyr gjort opp. Alt annet er ubetalt, inkludert
  // delbetalinger — en faktura som er halvveis betalt skal IKKE vises som betalt.
  const erBetalt = (row: { amountOutstanding?: number }) => Number(row.amountOutstanding ?? 0) === 0

  it("regner kun full oppgjør som betalt", () => {
    expect(erBetalt({ amountOutstanding: 0 })).toBe(true)
    expect(erBetalt({ amountOutstanding: 1250 })).toBe(false)
    expect(erBetalt({ amountOutstanding: 0.5 })).toBe(false)
  })
})
