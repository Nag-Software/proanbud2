import { calculateOfferTotals, type OfferLineItem } from "@/lib/tilbud/types"

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Omsetning (revenue) eks. mva for et tilbud = sum av linjer (påslag inkludert, rabatt trukket). */
export function computeOfferRevenue(lineItems: OfferLineItem[]): number {
  return calculateOfferTotals(lineItems).totalNok
}

/**
 * Kalkulert (estimert) materialkost = sum mengde × innkjøpspris (unitPriceNok, FØR påslag).
 * Brukes for «estimert vs faktisk»-sammenligning, ikke som omsetning.
 */
export function computeEstimatedMaterialCost(lineItems: OfferLineItem[]): number {
  return round(
    lineItems.reduce((sum, item) => {
      const qty = Number.isFinite(item.quantity) ? item.quantity : 0
      const unit = Number.isFinite(item.unitPriceNok) ? item.unitPriceNok : 0
      return sum + qty * unit
    }, 0),
  )
}

/** Faktisk lønnskost = timer × kostpris (kr/t). */
export function computeLaborCost(totalHours: number, costRateNok: number): number {
  const hours = Number.isFinite(totalHours) && totalHours > 0 ? totalHours : 0
  const rate = Number.isFinite(costRateNok) && costRateNok > 0 ? costRateNok : 0
  return round(hours * rate)
}

export type JobCosting = {
  revenueNok: number
  laborCostNok: number
  materialCostNok: number
  marginNok: number
  marginPct: number | null
}

/** Dekningsbidrag = omsetning − faktisk lønnskost − faktisk materialkost. */
export function computeJobCosting(input: {
  revenueNok: number
  laborCostNok: number
  materialCostNok: number
}): JobCosting {
  const revenueNok = round(input.revenueNok)
  const laborCostNok = round(input.laborCostNok)
  const materialCostNok = round(input.materialCostNok)
  const marginNok = round(revenueNok - laborCostNok - materialCostNok)
  const marginPct = revenueNok > 0 ? round((marginNok / revenueNok) * 100) : null
  return { revenueNok, laborCostNok, materialCostNok, marginNok, marginPct }
}
