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
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import {
  computeJobCosting,
  computeLaborCost,
  computePlannedCosts,
  resolveApprovedHours,
} from "@/lib/job-costing/calc"
import {
  buildLaborRateResolver,
  sumLaborCost,
  type EmployeeRateAssignment,
  type LaborRateRow,
} from "@/lib/job-costing/labor-rates"
import type {
  LaborByUser,
  MaterialCost,
  MaterialCostSync,
  PlannedSource,
  ProjectProfitability,
} from "@/lib/job-costing/types"
import { summarizeMaterialCosts } from "@/lib/regnskap/costs"
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
    assignmentsResult,
    accountingSyncsResult,
    revenuesResult,
    invoicesResult,
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
      .select("amount_nok, estimated_hours")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .eq("status", "accepted"),
    // Gjenbruker timeføringens egen spørring: den filtrerer bort avviste timer
    // og uferdige økter, slik at lønnskosten her er den samme timebunken som
    // Timeføring-fanen viser.
    fetchParticipantHours(supabase, input.projectId),
    // Alle materialkostnader — manuelle og bokførte i regnskapet (db/107) — i én tabell.
    supabase
      .from("project_material_costs")
      .select(
        "id, source, supplier_name, description, amount_nok, invoice_ref, cost_date, created_at, account_number, account_name, voucher_ref, replaced_by"
      )
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .order("cost_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }),
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
    // Alle timeprisene, også de uten kostpris: en ansatt kan være koblet til en
    // sats uten kostpris, og da skal UI-et kunne si hvilken.
    supabase
      .from("hourly_rates")
      .select("id, job_type, hourly_rate_nok, cost_rate_nok")
      .eq("company_id", input.companyId),
    // Hvem som er koblet til hvilken timepris (db/115). Leses med kallerens
    // klient: RLS slipper bare leder/admin gjennom, og det er også de som får se
    // lønnsomheten. Mangler tabellen, regnes alle med snittet som før.
    supabase
      .from("employee_hourly_rates")
      .select("user_id, hourly_rate_id")
      .eq("company_id", input.companyId),
    supabase
      .from("project_accounting_cost_syncs")
      .select("provider, pulled_at")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .order("pulled_at", { ascending: false })
      .limit(1),
    // Inntekt bokført på prosjektet i regnskapet (db/108) → «Fakturert».
    supabase
      .from("project_accounting_revenues")
      .select("amount_nok")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId),
    supabase
      .from("project_invoices")
      .select("amount_nok, status, created_at")
      .eq("company_id", input.companyId)
      .eq("project_id", input.projectId)
      .neq("status", "cancelled"),
  ])

  for (const [label, result] of [
    ["tilbud", offersResult],
    ["tilleggsarbeid", changeOrdersResult],
    ["materialkostnader", materialsResult],
    ["kjørebok", tripsResult],
    ["timepriser", ratesResult],
    ["ansattes timepriser", assignmentsResult],
    ["hentestatus fra regnskapet", accountingSyncsResult],
    ["inntekter fra regnskapet", revenuesResult],
    ["fakturaer", invoicesResult],
  ] as const) {
    // 42P01/PGRST205: db/105 er ikke kjørt ennå (PostgREST svarer PGRST205 for en
    // tabell den ikke kjenner). Da finnes det ingen regnskapskostnader, og fanen skal
    // vise det samme som før — ikke fylle feilloggen.
    if (result.error && result.error.code !== "42P01" && result.error.code !== "PGRST205") {
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

  // Hver ansatts timer regnes med kostprisen på timeprisen hen er koblet til;
  // ansatte uten kobling med snittet. Fanen sier eksplisitt hvilken sats hver
  // person har fått.
  const laborRates = buildLaborRateResolver(
    (ratesResult.data ?? []) as LaborRateRow[],
    (assignmentsResult.data ?? []) as EmployeeRateAssignment[]
  )
  const costRateNok = laborRates.averageCostRateNok

  const loggedHours = round(participantHours.reduce((sum, entry) => sum + entry.totalHours, 0))
  const laborCostNok = sumLaborCost(
    participantHours.map((entry) => ({ userId: entry.userId, hours: entry.totalHours })),
    laborRates.resolve
  )

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

  const materialCosts = ((materialsResult.data ?? []) as MaterialCost[]).map((row) => ({
    ...row,
    source: row.source ?? "manual",
    amount_nok: Number(row.amount_nok),
    replaced_by: row.replaced_by ?? null,
  }))
  // Bokført i regnskapet teller alltid; manuelle poster teller til samme kjøp er
  // funnet igjen som bokført (replaced_by), så ingenting telles to ganger.
  const { materialCostNok, ...materialSummary } = summarizeMaterialCosts(materialCosts)
  const lastSync = (accountingSyncsResult.data ?? [])[0] as
    | { provider: MaterialCostSync["provider"]; pulled_at: string }
    | undefined
  const costSync: MaterialCostSync | null = lastSync
    ? { provider: lastSync.provider, pulledAt: lastSync.pulled_at }
    : null

  // Kladdstatus på manuelle poster: koblingen sier «ligger som kladd», køen sier
  // «på vei» eller «feilet». Lest med service role — begge er synk-bokføring uten
  // brukerpolicy; selskapet er allerede verifisert av kalleren.
  const pendingManualIds = materialCosts
    .filter((row) => row.source === "manual" && !row.replaced_by)
    .map((row) => row.id)
  if (pendingManualIds.length > 0) {
    const admin = createAdminClient()
    const [linksResult, jobsResult] = await Promise.all([
      admin
        .from("external_entity_links")
        .select("local_id, sync_status")
        .eq("company_id", input.companyId)
        .in("entity_type", ["material_cost_draft", "material_cost_voucher"])
        .in("local_id", pendingManualIds),
      admin
        .from("integration_jobs")
        .select("payload, status, last_error_message, created_at")
        .eq("company_id", input.companyId)
        .eq("job_type", "material_cost.push")
        .in("payload->>materialCostId", pendingManualIds)
        .order("created_at", { ascending: false }),
    ])
    const sent = new Set(
      (linksResult.data ?? []).filter((row) => row.sync_status === "sent").map((row) => String(row.local_id))
    )
    const latestJob = new Map<string, { status: string; last_error_message: string | null }>()
    for (const job of jobsResult.data ?? []) {
      const id = String((job.payload as Record<string, unknown> | null)?.materialCostId ?? "")
      if (id && !latestJob.has(id)) latestJob.set(id, job)
    }
    for (const row of materialCosts) {
      if (row.source !== "manual" || row.replaced_by) continue
      const job = latestJob.get(row.id)
      if (sent.has(row.id)) row.accounting_status = "draft"
      else if (job && ["pending", "processing", "retry"].includes(job.status)) row.accounting_status = "pending"
      else if (job && ["failed", "dead_letter"].includes(job.status)) {
        row.accounting_status = "failed"
        row.accounting_error = job.last_error_message
      }
    }
  }

  const proanbudInvoices = (invoicesResult.data ?? []) as Array<{
    amount_nok: number | string
    status: string
    created_at: string
  }>
  const invoicesNok = (rows: typeof proanbudInvoices) =>
    round(rows.reduce((sum, row) => sum + Number(row.amount_nok || 0), 0))
  const paidNok = invoicesNok(proanbudInvoices.filter((row) => row.status === "paid"))
  const invoiced: ProjectProfitability["invoiced"] = costSync
    ? {
        // Fakturaer laget i ProAnbud etter siste henting har ikke rukket inn i
        // regnskapstallene ennå — de legges til så tallet ikke henger etter.
        totalNok: round(
          (revenuesResult.data ?? []).reduce((sum, row) => sum + Number(row.amount_nok || 0), 0) +
            invoicesNok(proanbudInvoices.filter((row) => row.created_at > costSync.pulledAt))
        ),
        paidNok,
        source: "regnskap",
      }
    : { totalNok: invoicesNok(proanbudInvoices), paidNok, source: "proanbud" }

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
  // Timelinjer med egen kostpris (fra timeprisen da tilbudet ble laget) bruker
  // den; eldre linjer uten faller tilbake på snittet.
  const rawPlanned =
    allLineItems.length > 0
      ? computePlannedCosts(allLineItems, { fallbackLaborCostRateNok: costRateNok })
      : null

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

  // Standardbudsjettet for timer er det kunden har sagt ja til: timene i de
  // aksepterte tilbudene (timelinjer + beregnede timer på fastprislinjer) pluss
  // anslåtte timer på godkjent tilleggsarbeid. Et timetall satt på prosjektet vinner.
  const changeOrderHours = round(
    changeOrders.reduce((sum, row) => sum + (Number(row.estimated_hours) || 0), 0)
  )
  const defaultHoursRaw = round((rawPlanned?.hours ?? 0) + changeOrderHours)
  const defaultHours = defaultHoursRaw > 0 ? defaultHoursRaw : null
  // Materialbudsjettet har bare et standardtall når tilbudet har ekte kostgrunnlag
  // (fastprislinjer sier hva kunden betaler, ikke hva materialene koster).
  const defaultMaterialNok =
    hasOfferCostBasis && rawPlanned && rawPlanned.materialCostNok > 0 ? rawPlanned.materialCostNok : null

  const plannedHours = budgetedHours ?? defaultHours
  const plannedMaterialNok = budgetedMaterialNok ?? defaultMaterialNok
  const budget: ProjectProfitability["budget"] = {
    hours: plannedHours,
    hoursSource: budgetedHours !== null ? "manuell" : defaultHours !== null ? "tilbud" : null,
    defaultHours,
    offerHours: round(rawPlanned?.hours ?? 0),
    changeOrderHours,
    materialNok: plannedMaterialNok,
    materialSource:
      budgetedMaterialNok !== null ? "manuell" : defaultMaterialNok !== null ? "tilbud" : null,
    defaultMaterialNok,
  }

  const plannedSource: PlannedSource | null =
    budgetedHours !== null || budgetedMaterialNok !== null
      ? "budsjett"
      : plannedHours !== null || plannedMaterialNok !== null
        ? "tilbud"
        : null

  // Kalkulert lønnskost:
  //  - Eget timebudsjett på prosjektet: timene × snittet (budsjettet sier ikke hvem
  //    som skal jobbe).
  //  - Ellers tilbudets timelinjer med kostprisen de fikk fra timeprisen, pluss
  //    timer utenfor timelinjene (fastprisjobber, tilleggsarbeid) × snittet — samme
  //    sats som førte timer uten kobling, så budsjett og faktisk er sammenlignbare.
  //  - Uten kostpris noe sted faller vi tilbake på timelinjenes salgsverdi, slik
  //    kalkylen alltid har gjort, så fanen ikke viser 0 i lønn.
  const plannedLaborCostNok = (() => {
    if (plannedHours === null) return 0
    if (budgetedHours !== null) return computeLaborCost(plannedHours, costRateNok)
    if (rawPlanned && (rawPlanned.laborCostNok > 0 || costRateNok > 0)) {
      const hoursOutsideLines = Math.max(0, plannedHours - rawPlanned.costBasisHours)
      return round(rawPlanned.laborCostNok + computeLaborCost(hoursOutsideLines, costRateNok))
    }
    if (costRateNok > 0) return computeLaborCost(plannedHours, costRateNok)
    return hasOfferCostBasis && rawPlanned ? rawPlanned.laborSalesNok : 0
  })()
  const plannedMaterialCostNok = plannedMaterialNok ?? 0

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
    .map((entry) => {
      const rate = laborRates.resolve(entry.userId)
      return {
        userId: entry.userId,
        name: entry.name,
        hours: round(entry.totalHours),
        costNok: computeLaborCost(entry.totalHours, rate.costRateNok),
        costRateNok: rate.costRateNok,
        rateSource: rate.source,
        jobType: rate.assignedJobType,
      }
    })
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
    laborRates: laborRates.coverage(
      participantHours.map((entry) => ({ userId: entry.userId, name: entry.name }))
    ),
    materialCosts,
    materialSummary,
    costSync,
    invoiced,
    laborByUser,
    budgetInput: { hours: budgetedHours, materialNok: budgetedMaterialNok },
    budget,
  }
}
