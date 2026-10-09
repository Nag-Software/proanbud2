import type { SupabaseClient } from "@supabase/supabase-js"

import { isHourUnit } from "@/lib/job-costing/calc"
import type { OfferLineItem } from "@/lib/tilbud/types"

/**
 * Arbeid i tilbud skal ALLTID være timer (unit «time») priset med bedriftens egne
 * timepriser. Timekalkylen («Timeforbruk mot kalkyle») og dekningsgraden leser
 * timene rett fra linjene: står flislegging som «22 m2», finnes det ingen timer å
 * sammenligne førte timer mot, og står den som 22 timer er kalkylen feil.
 */

export const LABOR_UNIT = "time"

/** Brukes når bedriften ikke har lagt inn egne timepriser (Mine priser → Timepriser). */
export const DEFAULT_HOURLY_RATE_NOK = 795
/** Transport/kjøring når bedriften ikke har en egen timepris for det. */
export const DEFAULT_TRANSPORT_RATE_NOK = 950

export type CompanyHourlyRate = {
  /** hourly_rates.id — følger med på tilbudslinja så kalkylen vet hvilken sats den kom fra. */
  id: string
  jobType: string
  /** Salgspris per time eks. mva — det kunden betaler. */
  hourlyRateNok: number
  /** Bedriftens selvkost per time. Null = ikke satt. */
  costRateNok: number | null
}

export type ResolvedHourlyRate = {
  rateNok: number
  jobType: string | null
  source: "company" | "default"
  kind?: "labor" | "transport"
  /** Timeprisen satsen kom fra. Null for standardsatsen. */
  id: string | null
  /** Kostprisen på timeprisen, når den er satt. */
  costRateNok: number | null
}

type HourlyRateRow = {
  id?: string | null
  job_type: string | null
  hourly_rate_nok: number | string | null
  cost_rate_nok?: number | string | null
}

export function mapHourlyRateRows(rows: HourlyRateRow[] | null | undefined): CompanyHourlyRate[] {
  return (rows ?? [])
    .map((row) => {
      const cost = row.cost_rate_nok === null || row.cost_rate_nok === undefined ? null : Number(row.cost_rate_nok)
      return {
        id: String(row.id ?? "").trim(),
        jobType: String(row.job_type ?? "").trim(),
        hourlyRateNok: Number(row.hourly_rate_nok),
        costRateNok: cost !== null && Number.isFinite(cost) && cost > 0 ? cost : null,
      }
    })
    .filter((rate) => rate.id && rate.jobType && Number.isFinite(rate.hourlyRateNok) && rate.hourlyRateNok > 0)
}

/** Bedriftens timepriser i sorteringsrekkefølge. Første rad er bedriftens standardsats. */
export async function fetchCompanyHourlyRates(
  supabase: SupabaseClient,
  companyId: string
): Promise<CompanyHourlyRate[]> {
  const { data, error } = await supabase
    .from("hourly_rates")
    .select("id, job_type, hourly_rate_nok, cost_rate_nok")
    .eq("company_id", companyId)
    .order("sort_order", { ascending: true })
    .order("job_type", { ascending: true })

  if (error) return []
  return mapHourlyRateRows(data as HourlyRateRow[])
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9æøå\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// «Tømrerarbeid» skal treffe «tømrer», «Flislegging» skal treffe «flislegger».
// Vi sammenligner derfor på ordstammer (de første 5 tegnene) i stedet for hele ord.
const STEM_LENGTH = 5
const GENERIC_WORDS = new Set(["arbeid", "arbei", "timer", "timep", "time", "jobb", "tjene", "og", "med", "for"])

function stems(value: string) {
  return normalize(value)
    .split(" ")
    .filter((word) => word.length >= 3)
    .map((word) => word.slice(0, STEM_LENGTH))
    .filter((stem) => !GENERIC_WORDS.has(stem))
}

/** Timeprisen hvis jobbtype best matcher teksten (tittel/kategori/beskrivelse), ellers null. */
export function matchHourlyRate(rates: CompanyHourlyRate[], text: string): CompanyHourlyRate | null {
  const textStems = new Set(stems(text))
  if (textStems.size === 0) return null

  let best: CompanyHourlyRate | null = null
  let bestScore = 0
  for (const rate of rates) {
    const score = stems(rate.jobType).filter((stem) => textStems.has(stem)).length
    if (score > bestScore) {
      best = rate
      bestScore = score
    }
  }
  return best
}

/**
 * Timeprisen en arbeidslinje skal ha: jobbtypen som matcher linjen, ellers
 * bedriftens første timepris, ellers standardsatsen.
 */
function fromCompanyRate(rate: CompanyHourlyRate, kind?: "labor" | "transport"): ResolvedHourlyRate {
  return {
    rateNok: rate.hourlyRateNok,
    jobType: rate.jobType,
    source: "company",
    id: rate.id,
    costRateNok: rate.costRateNok,
    ...(kind ? { kind } : {}),
  }
}

export function resolveHourlyRate(rates: CompanyHourlyRate[], text: string): ResolvedHourlyRate {
  const matched = matchHourlyRate(rates, text) ?? rates[0] ?? null
  if (matched) return fromCompanyRate(matched)
  return { rateNok: DEFAULT_HOURLY_RATE_NOK, jobType: null, source: "default", id: null, costRateNok: null }
}

/**
 * Timepris for transport/kjøring: bedriftens egen sats hvis den har en jobbtype som
 * passer («Transport», «Kjøring»), ellers standard transportsats. Faller IKKE
 * tilbake på første arbeidssats — kjøring er sjelden priset som fagarbeid.
 */
export function resolveTransportRate(rates: CompanyHourlyRate[], text: string): ResolvedHourlyRate {
  // «Kjøring til byggeplass» skal treffe en sats som heter «Transport», og omvendt.
  const matched = matchHourlyRate(rates, `${text} transport kjøring`)
  if (matched) return fromCompanyRate(matched, "transport")
  return {
    rateNok: DEFAULT_TRANSPORT_RATE_NOK,
    jobType: null,
    source: "default",
    kind: "transport",
    id: null,
    costRateNok: null,
  }
}

function roundToHalfHour(hours: number) {
  return Math.max(0.5, Math.round(hours * 2) / 2)
}

function describeRate(rate: ResolvedHourlyRate) {
  if (rate.source === "company") return `Timepris ${rate.rateNok} kr/t (${rate.jobType}, bedriftens timepriser).`
  return rate.kind === "transport"
    ? `Standard transportsats ${rate.rateNok} kr/t — legg inn en timepris for «Transport» under Mine priser → Timepriser.`
    : `Standard timepris ${rate.rateNok} kr/t — legg inn egne timepriser under Mine priser → Timepriser.`
}

/**
 * Gjør en arbeidslinje om til timer med riktig timepris.
 *
 * Står arbeidet i en annen enhet (m2, stk, lm, RS …), gjøres linjens sum om til
 * timer med timeprisen, så totalen for kunden blir omtrent den samme. Å beholde
 * mengden (22 m2 → 22 timer) ville gitt en helt feil timekalkyle.
 */
export function normalizeLaborLineItem(
  item: OfferLineItem,
  rates: CompanyHourlyRate[],
  options: { supplier?: string; rate?: ResolvedHourlyRate } = {}
): OfferLineItem {
  const rate = options.rate ?? resolveHourlyRate(rates, `${item.title} ${item.subproject} ${item.description}`)
  const quantity = Number.isFinite(item.quantity) && item.quantity > 0 ? item.quantity : 0
  const unitPrice = Number.isFinite(item.unitPriceNok) && item.unitPriceNok > 0 ? item.unitPriceNok : 0

  let hours: number
  let conversionNote = ""
  if (isHourUnit(item.unit)) {
    hours = quantity > 0 ? quantity : 1
  } else if (quantity > 0 && unitPrice > 0) {
    const lineSum = quantity * unitPrice * (1 + (item.markupPercent || 0) / 100)
    hours = roundToHalfHour(lineSum / rate.rateNok)
    conversionNote = ` Omregnet fra ${quantity} ${item.unit} til timer.`
  } else {
    hours = quantity > 0 ? quantity : 1
  }

  const reasoning = [item.reasoning?.trim(), `${describeRate(rate)}${conversionNote}`].filter(Boolean).join(" ")

  return {
    ...item,
    quantity: hours,
    unit: LABOR_UNIT,
    unitPriceNok: rate.rateNok,
    // Timeprisen ER salgsprisen — påslag på toppen ville gitt kunden en annen sats
    // enn den bedriften har bestemt.
    markupPercent: 0,
    supplier: item.supplier?.trim() || options.supplier || "",
    reasoning,
    // Prisen kommer fra bedriftens timepriser (eller standardsatsen), ikke fra KI-en.
    priceSource: undefined,
    // Hvilken timepris linja kom fra, og kostprisen på den akkurat nå — så
    // tilbudets kalkyle står fast og regnskapet får riktig enhetskost.
    hourlyRateId: rate.id ?? undefined,
    costRateNok: rate.costRateNok ?? undefined,
  }
}

/**
 * Kostpris-snapshotet gjelder bare timelinjer. Bytter noen enheten fra «time»
 * til m² eller stk, er linja en vare, og snapshotet ville bare forvirret
 * kalkylen. Fjernes derfor på alt som ikke er timer.
 */
export function sanitizeLaborSnapshot(item: OfferLineItem): OfferLineItem {
  if (isHourUnit(item.unit)) return item
  if (item.hourlyRateId === undefined && item.costRateNok === undefined) return item
  const rest: OfferLineItem = { ...item }
  delete rest.hourlyRateId
  delete rest.costRateNok
  return rest
}

/** Dekningsgraden på én timelinje — hvor mye av timeprisen som er igjen etter kostpris. */
export function laborLineMarginPct(item: Pick<OfferLineItem, "unitPriceNok" | "costRateNok">): number | null {
  const cost = Number(item.costRateNok)
  if (!Number.isFinite(cost) || cost <= 0 || !Number.isFinite(item.unitPriceNok) || item.unitPriceNok <= 0) return null
  return Math.round(((item.unitPriceNok - cost) / item.unitPriceNok) * 100)
}

/** Transport/kjøring føres også i timer, med transportsatsen. */
export function normalizeTransportLineItem(
  item: OfferLineItem,
  rates: CompanyHourlyRate[],
  options: { supplier?: string } = {}
): OfferLineItem {
  return normalizeLaborLineItem(item, rates, { ...options, rate: resolveTransportRate(rates, item.title) })
}

/** Kort tekst til KI-prompten med bedriftens timepriser. */
export function formatHourlyRatesForPrompt(rates: CompanyHourlyRate[]) {
  if (rates.length === 0) {
    return {
      kilde: "standard",
      standardTimeprisNok: DEFAULT_HOURLY_RATE_NOK,
      transportTimeprisNok: DEFAULT_TRANSPORT_RATE_NOK,
      veiledning: `Bedriften har ikke lagt inn egne timepriser. Bruk ${DEFAULT_HOURLY_RATE_NOK} kr/t på alt arbeid og ${DEFAULT_TRANSPORT_RATE_NOK} kr/t på transport.`,
    }
  }
  return {
    kilde: "bedriftens timepriser",
    standardTimeprisNok: rates[0].hourlyRateNok,
    transportTimeprisNok: matchHourlyRate(rates, "transport kjøring")?.hourlyRateNok ?? DEFAULT_TRANSPORT_RATE_NOK,
    satser: rates.map((rate) => ({ jobbtype: rate.jobType, timeprisNok: rate.hourlyRateNok })),
    veiledning:
      "Bruk timeprisen for jobbtypen som passer arbeidet. Passer ingen, bruk standardTimeprisNok. Transport: transportTimeprisNok. Finn aldri på egne timepriser.",
  }
}
