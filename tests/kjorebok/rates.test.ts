import { describe, expect, it } from "vitest"

import {
  computeTripAmount,
  getStatensSats,
  rateNokPerKm,
  roundOre,
} from "../../lib/kjorebok/rates"

describe("kjørebok statens satser", () => {
  it("2026 base = 5,30 kr/km", () => {
    expect(getStatensSats(2026).baseNokPerKm).toBe(5.3)
    // Unknown year falls back to the default year's table.
    expect(getStatensSats(1999).baseNokPerKm).toBe(5.3)
  })

  it("effektiv sats = base + passasjerer×1 + anleggsvei×1", () => {
    expect(rateNokPerKm({ passengers: 0, anleggsvei: false })).toBe(5.3)
    expect(rateNokPerKm({ passengers: 2, anleggsvei: false })).toBe(7.3)
    expect(rateNokPerKm({ passengers: 0, anleggsvei: true })).toBe(6.3)
    expect(rateNokPerKm({ passengers: 3, anleggsvei: true })).toBe(9.3)
  })

  it("beløp = distanse × effektiv sats, avrundet til øre", () => {
    expect(computeTripAmount({ distanceKm: 10, passengers: 0, anleggsvei: false })).toEqual({
      rateNokPerKm: 5.3,
      amountNok: 53,
    })
    expect(computeTripAmount({ distanceKm: 12.5, passengers: 1, anleggsvei: false })).toEqual({
      rateNokPerKm: 6.3,
      amountNok: 78.75,
    })
  })

  it("robust mot 0/negativ distanse og passasjerer", () => {
    expect(computeTripAmount({ distanceKm: 0, passengers: 0, anleggsvei: false }).amountNok).toBe(0)
    expect(computeTripAmount({ distanceKm: -5, passengers: 0, anleggsvei: false }).amountNok).toBe(0)
    expect(rateNokPerKm({ passengers: -2, anleggsvei: false })).toBe(5.3)
  })

  it("roundOre unngår float-drift", () => {
    expect(roundOre(1.005)).toBe(1.01)
    expect(roundOre(53.0)).toBe(53)
  })
})
