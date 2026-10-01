import {
  calculateLineItemTotal,
  calculateOfferTotals,
  type OfferLineItem,
} from "@/lib/tilbud/types"

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

/**
 * Enheter som betyr «dette er arbeidstid», ikke en vare.
 *
 * Tilbudslinjene lages med `unit: "time"` på arbeid (se analysis-system-prompt),
 * men brukeren kan ha skrevet noe annet for hånd. Vi tar med de vanlige
 * skrivemåtene og lar alt annet telle som material — feil vei å bomme på er å
 * kalle en vare for arbeid, for da forsvinner den ut av materialkalkylen.
 */
const HOUR_UNITS = new Set(["time", "timer", "t", "arbeidstime", "arbeidstimer", "h", "tim"])

export function isHourUnit(unit: string | null | undefined): boolean {
  return HOUR_UNITS.has((unit ?? "").trim().toLowerCase())
}

/**
 * Enheter der linjeprisen er en SALGSPRIS, ikke en kostpris.
 *
 * En fastprislinje er «hele jobben til 74 750 kr» — den sier ingenting om hva
 * arbeidet og materialene koster bedriften. Regnes den som kostnad, blir
 * kalkylens dekningsbidrag 0 kr, altså en påstand om at jobben aldri var ment
 * å tjene penger. Slike linjer holdes derfor utenfor kostnadskalkylen, og
 * salgsverdien deres føres for seg så vi vet hvor mye av tilbudet vi mangler
 * kostgrunnlag for.
 */
const SALES_PRICE_UNITS = new Set(["fastpris", "rs", "rund sum", "rundsum"])

export function isSalesPriceUnit(unit: string | null | undefined): boolean {
  return SALES_PRICE_UNITS.has((unit ?? "").trim().toLowerCase())
}

/**
 * Bedriftens kostpris per time: snittet av kostprisene som faktisk er satt i
 * Timepriser. Timeprisene er per jobbtype, ikke per ansatt, så et snitt er det
 * beste grunnlaget vi har. 0 betyr «ingen kostpris satt».
 *
 * Lønnsomhet-fanen og kostprisen som sendes til regnskapet bruker begge denne,
 * så dekningsgraden i Proanbud og i regnskapsprogrammet regnes av samme sats.
 */
export function averageCostRate(rates: Array<{ cost_rate_nok: unknown }>): number {
  const values = rates
    .map((row) => Number(row.cost_rate_nok))
    .filter((value) => Number.isFinite(value) && value > 0)
  return values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : 0
}

/**
 * Kostpris per enhet på en tilbudslinje, eks. mva — det regnskapet trenger for å
 * regne dekningsgrad. `null` betyr «ukjent», og skal sendes som ingenting, ikke 0.
 *
 * - Material: innprisen (`unitPriceNok`, før påslag).
 * - Timer: bedriftens kostpris per time. Timelinjens `unitPriceNok` er SALGSprisen,
 *   så den kan ikke brukes som kost. Uten kostpris i Timepriser er kosten ukjent.
 * - Fastpris/RS: bare salgspris, ingen kostnadsdeling — ukjent.
 */
export function lineUnitCost(
  item: Pick<OfferLineItem, "unit" | "unitPriceNok">,
  laborCostRateNok: number | null | undefined
): number | null {
  if (isSalesPriceUnit(item.unit)) return null
  if (isHourUnit(item.unit)) {
    const rate = Number(laborCostRateNok)
    return Number.isFinite(rate) && rate > 0 ? round(rate) : null
  }
  const unitPrice = Number(item.unitPriceNok)
  return Number.isFinite(unitPrice) && unitPrice >= 0 ? round(unitPrice) : null
}

export type PlannedCosts = {
  /** Kalkulert lønnskost = timelinjenes mengde × kostpris i tilbudet (før påslag). */
  laborCostNok: number
  /** Kalkulert materialkost = øvrige linjers mengde × innkjøpspris (før påslag). */
  materialCostNok: number
  /**
   * Kalkulerte timer = mengde på timelinjene + beregnede timer på fastprislinjer
   * (lagrede jobber). Dette er timetallet førte timer måles mot.
   */
  hours: number
  /**
   * Timer på timelinjene alene — de som også har kostgrunnlag. Brukes når
   * lønnskosten regnes om med kostpris, så fastprislinjenes timer ikke gir
   * kostnad uten tilhørende omsetning i kostgrunnlaget.
   */
  costBasisHours: number
  /** Salgsverdien av linjene vi HAR kostgrunnlag for. */
  costBasisRevenueNok: number
  /** Salgsverdien av fastprislinjer — pris uten kostnadsdeling. */
  fixedPriceRevenueNok: number
}

/**
 * Splitter tilbudets linjer i kalkulert lønnskost og kalkulert materialkost.
 *
 * Grunnlaget er `unitPriceNok` — altså SELVKOST før påslag og rabatt. Det er den
 * eneste tolkningen som lar «kalkyle mot faktisk» bli en ekte sammenligning:
 * begge sider er da hva jobben koster bedriften, ikke hva kunden betaler.
 */
export function computePlannedCosts(lineItems: OfferLineItem[]): PlannedCosts {
  let laborCostNok = 0
  let materialCostNok = 0
  let hours = 0
  let costBasisHours = 0
  let costBasisRevenueNok = 0
  let fixedPriceRevenueNok = 0

  for (const item of lineItems) {
    const qty = Number.isFinite(item.quantity) ? item.quantity : 0
    const unitPrice = Number.isFinite(item.unitPriceNok) ? item.unitPriceNok : 0
    const cost = qty * unitPrice
    const lineRevenue = calculateLineItemTotal(item)
    const unit = (item.unit ?? "").trim().toLowerCase()

    if (isSalesPriceUnit(unit)) {
      fixedPriceRevenueNok += lineRevenue
      const plannedHours = Number(item.plannedHours)
      if (Number.isFinite(plannedHours) && plannedHours > 0) {
        hours += qty * plannedHours
      }
      continue
    }

    costBasisRevenueNok += lineRevenue
    if (isHourUnit(unit)) {
      laborCostNok += cost
      hours += qty
      costBasisHours += qty
    } else {
      materialCostNok += cost
    }
  }

  return {
    laborCostNok: round(laborCostNok),
    materialCostNok: round(materialCostNok),
    hours: round(hours),
    costBasisHours: round(costBasisHours),
    costBasisRevenueNok: round(costBasisRevenueNok),
    fixedPriceRevenueNok: round(fixedPriceRevenueNok),
  }
}

export type ApprovedHoursResult = {
  value: number | null
  source: "manuell" | "tilbud" | null
}

/**
 * Godkjente timer — kundens tak. Manuell overstyring vinner alltid når satt;
 * ellers timer fra HOUR_UNITS-linjene i aksepterte tilbud (uansett om de
 * brukes som kalkylegrunnlag eller ikke — kundens tak er ikke betinget av
 * kalkylens 50 %-terskel for kostgrunnlag).
 */
export function resolveApprovedHours(
  manualHours: number | null,
  offerHours: number | null
): ApprovedHoursResult {
  if (manualHours !== null && manualHours !== undefined && Number.isFinite(manualHours)) {
    return { value: round(manualHours), source: "manuell" }
  }
  if (offerHours !== null && offerHours !== undefined && Number.isFinite(offerHours) && offerHours > 0) {
    return { value: round(offerHours), source: "tilbud" }
  }
  return { value: null, source: null }
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
