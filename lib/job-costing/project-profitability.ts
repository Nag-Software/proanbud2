import "server-only"

/**
 * Lønnsomheten på ett prosjekt: hva jobben har gitt inn, hva den har kostet,
 * hvordan det står mot målet, og hvor den ender med dagens forbruk.
 *
 * Ligger her og ikke i server-actionen fordi to steder trenger nøyaktig samme
 * tall: utdraget på Oversikt-fanen (server-rendret med prosjektsiden) og
 * Lønnsomhet-fanen. Regnes de ut hver for seg, er det bare et spørsmål om tid
 * før de to sier forskjellige ting om samme prosjekt.
 */

import type { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"
import {
  computeJobCosting,
  computeLaborCost,
  computePlannedCosts,
  resolveApprovedHours,
} from "@/lib/job-costing/calc"
import type {
  LaborByUser,
  MaterialCost,
  PlannedSource,
  ProjectProfitability,
} from "@/lib/job-costing/types"
import { fetchParticipantHours } from "@/lib/timeforing/participant-hours"
import type { OfferLineItem } from "@/lib/tilbud/types"

type ServerClient = Awaited<ReturnType<typeof createClient>>

export type ProjectBudgetInput = {
  budgetNok: number | null
  budgetedHours: number | null
  budgetedMaterialNok: number | null
  progressPercent: number | null
  /** Manuell overstyring av godkjente timer. `null` = bruk tilbudets timer. */
  approvedHours: number | null
  isHourlyBilling: boolean
  hourlyBillingRateNok: number | null
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/** Linjene ligger som JSONB. Alt som ikke er en liste av objekter forkastes. */
function readLineItems(value: unknown): OfferLineItem[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is OfferLineItem => Boolean(item) && typeof item === "object")
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Plukker budsjett-, framdrifts- og timeavtalefeltene ut av en prosjektrad.
 *
 * Leser defensivt fordi feltene kom i db/76 og db/77: i en base der
 * migrasjonene ikke er kjørt finnes de rett og slett ikke, og da skal
 * lønnsomheten vise «ikke satt» i stedet for å kræsje.
 */
export function readProjectBudget(project: Record<string, unknown>): ProjectBudgetInput {
  return {
    budgetNok: toNumberOrNull(project.budget_nok),
    budgetedHours: toNumberOrNull(project.budgeted_hours),
    budgetedMaterialNok: toNumberOrNull(project.budgeted_material_nok),
    progressPercent: toNumberOrNull(project.progress_percent),
    approvedHours: toNumberOrNull(project.approved_hours),
    isHourlyBilling: project.is_hourly_billing === true,
    hourlyBillingRateNok: toNumberOrNull(project.hourly_billing_rate_nok),
  }
}

export async function fetchProjectProfitability(
  supabase: ServerClient,
  input: { companyId: string; projectId: string } & ProjectBudgetInput
): Promise<ProjectProfitability> {
  const [
    offersResult,
    changeOrdersResult,
    participantHours,
    materialsResult,
    tripsResult,
    ratesResult,
  ] = await Promise.all([
    supabase
      .from("offers")
      .select("amount_nok, line_items")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .eq("status", "accepted"),
    // Godkjent tilleggsarbeid ER omsetning. Aksepten flipper bare status på
    // change_orders — den rører aldri offers.amount_nok — så uten denne
    // spørringen ville timene og materialene for tillegget telt som kostnad
    // mens inntekten manglet, og resultatet blitt for dårlig nettopp på de
    // jobbene der det ble tjent mest.
    supabase
      .from("change_orders")
      .select("amount_nok")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .eq("status", "accepted"),
    // Gjenbruker timeføringens egen spørring: den filtrerer bort avviste timer
    // og uferdige økter, slik at lønnskosten her er den samme timebunken som
    // Timeføring-fanen viser.
    fetchParticipantHours(supabase, input.projectId),
    supabase
      .from("project_material_costs")
      .select("id, supplier_name, description, amount_nok, invoice_ref, cost_date, created_at")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .order("cost_date", { ascending: false, nullsFirst: false }),
    // Kjøregodtgjørelse er ekte utbetalte penger på prosjektet, og registreres
    // allerede uten at noen må taste noe. `amount_nok` er statens sats — altså
    // det bedriften betaler ut. `fuel_cost_nok` er bare et anslag på hva
    // drivstoffet kostet, og skal IKKE legges oppå: da teller vi samme tur to
    // ganger. Private turer er ikke prosjektkostnad.
    supabase
      .from("kjorebok_trips")
      .select("amount_nok")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .eq("classification", "business"),
    supabase
      .from("hourly_rates")
      .select("cost_rate_nok")
      .eq("company_id", input.companyId)
      .not("cost_rate_nok", "is", null),
  ])

  for (const [label, result] of [
    ["tilbud", offersResult],
    ["tilleggsarbeid", changeOrdersResult],
    ["materialkostnader", materialsResult],
    ["kjørebok", tripsResult],
    ["timepriser", ratesResult],
  ] as const) {
    if (result.error) {
      await logServerError({
        message: `Kunne ikke hente ${label} til lønnsomhet`,
        error: result.error,
        source: "server",
        route: "fetchProjectProfitability",
        context: { projectId: input.projectId },
      })
    }
  }

  const offers = offersResult.data ?? []
  const changeOrders = changeOrdersResult.data ?? []
  const offersNok = round(offers.reduce((sum, offer) => sum + Number(offer.amount_nok || 0), 0))
  const changeOrdersNok = round(
    changeOrders.reduce((sum, row) => sum + Number(row.amount_nok || 0), 0)
  )

  // Snitt av de kostprisene bedriften faktisk har satt. Timeprisene er per
  // jobbtype, ikke per ansatt, så et snitt er det beste grunnlaget vi har —
  // og fanen sier eksplisitt hvilken sats den har regnet med.
  const costRates = (ratesResult.data ?? [])
    .map((row) => Number(row.cost_rate_nok))
    .filter((value) => Number.isFinite(value) && value > 0)
  const costRateNok = costRates.length
    ? round(costRates.reduce((a, b) => a + b, 0) / costRates.length)
    : 0

  const loggedHours = round(participantHours.reduce((sum, entry) => sum + entry.totalHours, 0))
  const laborCostNok = computeLaborCost(loggedHours, costRateNok)

  // Løpende regning: jobben faktureres etter medgåtte timer, så omsetningen
  // vokser med timene i stedet for å stå fast på en tilbudssum. Lagt til de
  // andre kildene, ikke i stedet for dem — et prosjekt kan ha en fast del og
  // en løpende del samtidig. Uten dette ble omsetningen 0 kr på rene
  // regningsjobber, som gjorde hele dekningsgraden ubrukelig for dem.
  const hourlyRateToCustomer = toNumberOrNull(input.hourlyBillingRateNok)
  const hourlyNok =
    input.isHourlyBilling && hourlyRateToCustomer !== null && hourlyRateToCustomer > 0
      ? round(loggedHours * hourlyRateToCustomer)
      : 0

  const revenueNok = round(offersNok + changeOrdersNok + hourlyNok)

  const materialCosts = (materialsResult.data ?? []) as MaterialCost[]
  const materialCostNok = round(
    materialCosts.reduce((sum, row) => sum + Number(row.amount_nok || 0), 0)
  )

  const drivingCostNok = round(
    (tripsResult.data ?? []).reduce((sum, row) => sum + Number(row.amount_nok || 0), 0)
  )

  // Kjøring legges i samme kostnadspott som material i dekningsbidraget — den
  // er en direkte prosjektkostnad — men vises på egen linje, så det er synlig
  // hvor pengene gikk.
  const actualCosting = computeJobCosting({
    revenueNok,
    laborCostNok,
    materialCostNok: materialCostNok + drivingCostNok,
  })
  const actualTotalCostNok = round(laborCostNok + materialCostNok + drivingCostNok)
  const actual = {
    laborCostNok,
    materialCostNok,
    drivingCostNok,
    totalCostNok: actualTotalCostNok,
    marginNok: actualCosting.marginNok,
    marginPct: actualCosting.marginPct,
  }

  const allLineItems = offers.flatMap((offer) => readLineItems(offer.line_items))
  const rawPlanned = allLineItems.length > 0 ? computePlannedCosts(allLineItems) : null

  // Fastprislinjer har salgspris, ikke kostpris. Dekker de mesteparten av
  // tilbudet, finnes det ingen ekte kalkyle i tilbudet — da faller vi tilbake
  // på målet prosjektlederen har satt, i stedet for å vise en «kalkulert
  // dekningsgrad» på 0 % som ser ut som at jobben var tapsprosjekt fra dag én.
  const coveredRevenue = rawPlanned
    ? rawPlanned.costBasisRevenueNok + rawPlanned.fixedPriceRevenueNok
    : 0
  const hasOfferCostBasis =
    rawPlanned !== null &&
    coveredRevenue > 0 &&
    rawPlanned.costBasisRevenueNok / coveredRevenue >= 0.5

  const budgetedHours = toNumberOrNull(input.budgetedHours)
  const budgetedMaterialNok = toNumberOrNull(input.budgetedMaterialNok)
  const hasManualBudget = budgetedHours !== null || budgetedMaterialNok !== null

  let plannedSource: PlannedSource | null = null
  let plannedLaborCostNok = 0
  let plannedMaterialCostNok = 0
  let plannedHours: number | null = null

  if (hasOfferCostBasis && rawPlanned) {
    plannedSource = "tilbud"
    plannedLaborCostNok = rawPlanned.laborCostNok
    plannedMaterialCostNok = rawPlanned.materialCostNok
    plannedHours = rawPlanned.hours > 0 ? rawPlanned.hours : null
  } else if (hasManualBudget) {
    plannedSource = "budsjett"
    plannedLaborCostNok = computeLaborCost(budgetedHours ?? 0, costRateNok)
    plannedMaterialCostNok = budgetedMaterialNok ?? 0
    plannedHours = budgetedHours
  }

  const planned = plannedSource
    ? (() => {
        const costing = computeJobCosting({
          revenueNok,
          laborCostNok: plannedLaborCostNok,
          materialCostNok: plannedMaterialCostNok,
        })
        return {
          laborCostNok: costing.laborCostNok,
          materialCostNok: costing.materialCostNok,
          totalCostNok: round(costing.laborCostNok + costing.materialCostNok),
          marginNok: costing.marginNok,
          marginPct: costing.marginPct,
          hours: plannedHours,
        }
      })()
    : null

  const plannedMissingReason: ProjectProfitability["plannedMissingReason"] = plannedSource
    ? null
    : offers.length === 0
      ? "no_offers"
      : rawPlanned === null || coveredRevenue === 0
        ? "no_lines"
        : "fixed_price"

  const laborByUser: LaborByUser[] = participantHours
    .map((entry) => ({
      userId: entry.userId,
      name: entry.name,
      hours: round(entry.totalHours),
      costNok: computeLaborCost(entry.totalHours, costRateNok),
    }))
    .sort((a, b) => b.hours - a.hours)

  return {
    revenueNok,
    revenue: { offersNok, changeOrdersNok, hourlyNok: 0 },
    budgetNok: toNumberOrNull(input.budgetNok),
    acceptedOfferCount: offers.length,
    acceptedChangeOrderCount: changeOrders.length,
    planned,
    plannedSource,
    plannedMissingReason,
    actual,
    // ⚠️ Timeavtale/løpende timefakturering bygges i en PARALLELL økt: typene
    // er på plass, utregningen er det ikke. Nøytralverdier her holder bygget
    // grønt uten å gjette på den logikken — den økta skal skrive dem ordentlig.
    approvedHours: null,
    approvedHoursSource: null,
    hourlyBilling: { enabled: false, rateNok: null },
    hoursAgreementInput: {
      approvedHours: null,
      isHourlyBilling: false,
      hourlyBillingRateNok: null,
    },
    hours: {
      logged: loggedHours,
      planned: plannedHours,
    },
    costRateNok,
    materialCosts,
    laborByUser,
    budgetInput: { hours: budgetedHours, materialNok: budgetedMaterialNok },
  }
}
