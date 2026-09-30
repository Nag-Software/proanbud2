import type { createClient } from "@/lib/supabase/client"

import { bucketize, resolveKpiPeriod, type KpiKey, type KpiPeriodKey } from "./dashboard-kpi-periods"

type SupabaseClient = ReturnType<typeof createClient>

export type KpiResult = {
  /** Perioden tallene faktisk gjelder — kortet leser etiketten herfra. */
  period: KpiPeriodKey
  value: number
  /** Null når perioden ikke har noe å sammenlignes med («Totalt»). */
  prev: number | null
  points: Array<{ label: string; value: number }>
}

/** Tellekortene: hvilken tabell, og hvilke rader som teller. */
const COUNT_SOURCES = {
  prosjekter: { table: "projects", excludeDrafts: false },
  tilbud: { table: "offers", excludeDrafts: true },
  kunder: { table: "customers", excludeDrafts: false },
} as const

/**
 * Godkjente tilbud telles på datoen de ble godkjent, ikke da de ble opprettet.
 * Eldre tilbud uten `accepted_at` faller tilbake på opprettet-dato.
 */
function acceptedIn(from: Date | null, to: Date): string {
  const end = to.toISOString()
  if (!from) return `accepted_at.lt.${end},and(accepted_at.is.null,created_at.lt.${end})`
  const start = from.toISOString()
  return `and(accepted_at.gte.${start},accepted_at.lt.${end}),and(accepted_at.is.null,created_at.gte.${start},created_at.lt.${end})`
}

/**
 * Ett KPI-kort for én periode: tallet, forrige tilsvarende periode og søylene.
 * Maks to spørringer per kort — én når perioden ikke har sammenligning.
 */
export async function fetchKpi(
  supabase: SupabaseClient,
  companyId: string,
  key: KpiKey,
  periodKey: KpiPeriodKey,
  now: Date = new Date()
): Promise<KpiResult> {
  const period = resolveKpiPeriod(periodKey, now)

  if (key === "omsetning") {
    const accepted = () =>
      supabase.from("offers").select("amount_nok, accepted_at, created_at").eq("company_id", companyId).eq("status", "accepted")

    const [current, previous] = await Promise.all([
      accepted().or(acceptedIn(period.from, period.to)),
      period.compare ? accepted().or(acceptedIn(period.compare.from, period.compare.to)) : null,
    ])

    const rows = (current.data || []).map((offer) => ({
      date: new Date(offer.accepted_at ?? offer.created_at),
      value: offer.amount_nok || 0,
    }))
    return {
      period: periodKey,
      value: rows.reduce((sum, row) => sum + row.value, 0),
      prev: previous ? (previous.data || []).reduce((sum, offer) => sum + (offer.amount_nok || 0), 0) : null,
      points: bucketize(period, rows, now),
    }
  }

  const source = COUNT_SOURCES[key]
  const inRange = (from: Date | null, to: Date, head: boolean) => {
    // Radene trengs bare til søylene; `count` er det eksakte tallet også når det
    // finnes flere rader enn ett svar rommer. Nyeste først, så det er de eldste
    // søylene som eventuelt blir for lave — aldri den du ser på nå.
    let query = supabase
      .from(source.table)
      .select("created_at", { count: "exact", head })
      .eq("company_id", companyId)
      .lt("created_at", to.toISOString())
    if (from) query = query.gte("created_at", from.toISOString())
    if (source.excludeDrafts) query = query.neq("status", "draft")
    return head ? query : query.order("created_at", { ascending: false })
  }

  const [current, previous] = await Promise.all([
    inRange(period.from, period.to, false),
    period.compare ? inRange(period.compare.from, period.compare.to, true) : null,
  ])

  const rows = ((current.data as Array<{ created_at: string }> | null) || []).map((row) => ({
    date: new Date(row.created_at),
    value: 1,
  }))
  return {
    period: periodKey,
    value: current.count ?? rows.length,
    prev: previous ? previous.count || 0 : null,
    points: bucketize(period, rows, now),
  }
}
