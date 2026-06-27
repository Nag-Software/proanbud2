import { describe, expect, it } from "vitest"

import {
  computeFuelCost,
  fuelPriceForType,
  FUEL_PRICE_NOK_PER_LITER,
} from "../../lib/kjorebok/fuel"

describe("kjørebok drivstoffutgifter", () => {
  it("priser bare forbrenningsdrivstoff per liter", () => {
    expect(fuelPriceForType("diesel")).toBe(18)
    expect(fuelPriceForType("petrol")).toBe(18)
    expect(fuelPriceForType("hybrid")).toBe(18)
    // Ikke literbasert → ingen pris.
    expect(fuelPriceForType("electric")).toBe(0)
    expect(fuelPriceForType("hydrogen")).toBe(0)
    expect(fuelPriceForType("other")).toBe(0)
    expect(fuelPriceForType(null)).toBe(0)
  })

  it("kostnad = forbruk × (km/10) × 18 kr", () => {
    // 0,8 l/mil over 100 km = 8 liter = 144 kr.
    expect(computeFuelCost({ distanceKm: 100, consumptionLPerMil: 0.8, fuelType: "diesel" })).toEqual({
      liters: 8,
      pricePerLiter: 18,
      costNok: 144,
    })
    // 0,7 l/mil over 25 km = 1,75 liter = 31,50 kr.
    expect(computeFuelCost({ distanceKm: 25, consumptionLPerMil: 0.7, fuelType: "petrol" })).toEqual({
      liters: 1.75,
      pricePerLiter: 18,
      costNok: 31.5,
    })
  })

  it("gir 0 for elektrisk uansett forbruk", () => {
    const res = computeFuelCost({ distanceKm: 100, consumptionLPerMil: 2, fuelType: "electric" })
    expect(res.costNok).toBe(0)
    expect(res.liters).toBe(0)
    expect(res.pricePerLiter).toBe(0)
  })

  it("gir 0 når forbruk mangler eller er ugyldig", () => {
    expect(computeFuelCost({ distanceKm: 50, consumptionLPerMil: null, fuelType: "diesel" }).costNok).toBe(0)
    expect(computeFuelCost({ distanceKm: 50, consumptionLPerMil: 0, fuelType: "diesel" }).costNok).toBe(0)
    expect(computeFuelCost({ distanceKm: 50, consumptionLPerMil: -1, fuelType: "diesel" }).costNok).toBe(0)
  })

  it("gir 0 for 0/negativ distanse", () => {
    expect(computeFuelCost({ distanceKm: 0, consumptionLPerMil: 0.8, fuelType: "diesel" }).costNok).toBe(0)
    expect(computeFuelCost({ distanceKm: -10, consumptionLPerMil: 0.8, fuelType: "diesel" }).costNok).toBe(0)
  })

  it("FUEL_PRICE_NOK_PER_LITER er 18", () => {
    expect(FUEL_PRICE_NOK_PER_LITER).toBe(18)
  })
})
