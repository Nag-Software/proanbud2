// Drivstoffutgifter (fuel cost) for the kjørebok.
//
// Pure and dependency-free (like rates.ts) so it runs identically on server
// actions, the client wizard, and tests. Consumption is expressed in LITER PER
// MIL (1 mil = 10 km) — the unit Norwegian drivers use ("0,8 på mila").
//
// Fuel price is a deliberately simplified flat rate: 18 kr/liter for combustion
// fuels (bensin/diesel/hybrid). Electric/hydrogen/other are not metered in
// liters, so they get no per-liter estimate (cost 0). When the price changes,
// bump FUEL_PRICE_NOK_PER_LITER — trips snapshot the price they were saved with
// (kjorebok_trips.fuel_price_nok_per_liter), so historical rows stay stable.

import type { FuelType } from "./types"
import { roundOre } from "./rates"

/** Flat fuel price (kr/liter) for combustion fuels. */
export const FUEL_PRICE_NOK_PER_LITER = 18

/** 1 norsk mil = 10 km. */
export const KM_PER_MIL = 10

/** Fuel types we price per liter (i.e. burn liquid fuel). */
const PRICED_FUELS: ReadonlySet<FuelType> = new Set(["diesel", "petrol", "hybrid"])

/** kr/liter for a fuel type; 0 when we don't estimate it (electric, hydrogen, other, unknown). */
export function fuelPriceForType(type: FuelType | null | undefined): number {
  return type && PRICED_FUELS.has(type) ? FUEL_PRICE_NOK_PER_LITER : 0
}

export type FuelCostInput = {
  distanceKm: number
  /** Vehicle consumption in liter per mil (1 mil = 10 km). */
  consumptionLPerMil: number | null | undefined
  fuelType: FuelType | null | undefined
}

export type FuelCost = {
  /** Estimated liters consumed. */
  liters: number
  /** kr/liter applied (0 when not priced). */
  pricePerLiter: number
  /** Estimated fuel cost in kr. */
  costNok: number
}

/**
 * Estimated fuel usage + cost for a trip. Returns zeros (with the resolved
 * price/liter) when consumption is unknown/≤0, distance ≤0, or the fuel type
 * isn't priced per liter (e.g. electric) — i.e. "no estimate" rather than an
 * error, so callers can simply show "—".
 */
export function computeFuelCost(input: FuelCostInput): FuelCost {
  const pricePerLiter = fuelPriceForType(input.fuelType)
  const consumption = Number(input.consumptionLPerMil)
  const distance = Number(input.distanceKm)
  if (
    !pricePerLiter ||
    !Number.isFinite(consumption) ||
    consumption <= 0 ||
    !Number.isFinite(distance) ||
    distance <= 0
  ) {
    return { liters: 0, pricePerLiter, costNok: 0 }
  }
  const liters = consumption * (distance / KM_PER_MIL)
  return {
    liters: roundOre(liters),
    pricePerLiter,
    costNok: roundOre(liters * pricePerLiter),
  }
}
