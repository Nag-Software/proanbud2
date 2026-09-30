/**
 * Periodene et KPI-kort på dashbordet kan vise.
 *
 * Ren datologikk uten Supabase og uten React, så den kan testes alene. Alle
 * intervaller er halvåpne — [from, to) — så en rad aldri havner i to perioder.
 */

export type KpiKey = "omsetning" | "prosjekter" | "tilbud" | "kunder"

export type KpiPeriodKey = "month" | "quarter" | "year" | "last12" | "lastYear" | "all"

export const KPI_KEYS: readonly KpiKey[] = ["omsetning", "prosjekter", "tilbud", "kunder"]

/** Rekkefølgen valgene står i dialogen: fra kortest til lengst. */
export const KPI_PERIOD_KEYS: readonly KpiPeriodKey[] = [
  "month",
  "quarter",
  "year",
  "last12",
  "lastYear",
  "all",
]

/**
 * Omsetning, prosjekter og tilbud følger regnskapsåret. Kundelisten er ikke
 * knyttet til noe år — der er det totalen som er tallet.
 */
export const DEFAULT_KPI_PERIODS: Record<KpiKey, KpiPeriodKey> = {
  omsetning: "year",
  prosjekter: "year",
  tilbud: "year",
  kunder: "all",
}

export type KpiBucket = { label: string; from: Date; to: Date }

export type KpiPeriod = {
  key: KpiPeriodKey
  /** «I år», «Denne måneden» … — står på kortet og i dialogen. */
  label: string
  /** Null = ingen nedre grense (all historikk). */
  from: Date | null
  to: Date
  /** «1. jan. – 30. sep. 2026» */
  rangeText: string
  /** Forrige tilsvarende periode. Null når det ikke finnes noe å sammenligne med. */
  compare: { from: Date; to: Date } | null
  /** «Mot samme periode i 2025» */
  compareText: string
  /** Søylene i kortet. Null = én søyle per år, utledet av dataene. */
  buckets: KpiBucket[] | null
}

const dayMonth = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "short" })
const monthShort = new Intl.DateTimeFormat("nb-NO", { month: "short" })
const monthLong = new Intl.DateTimeFormat("nb-NO", { month: "long" })

function shortMonth(date: Date): string {
  return monthShort.format(date).replace(".", "")
}

function formatRange(from: Date, last: Date): string {
  const sameYear = from.getFullYear() === last.getFullYear()
  const start = sameYear ? dayMonth.format(from) : `${dayMonth.format(from)} ${from.getFullYear()}`
  return `${start} – ${dayMonth.format(last)} ${last.getFullYear()}`
}

export function isKpiPeriodKey(value: unknown): value is KpiPeriodKey {
  return typeof value === "string" && (KPI_PERIOD_KEYS as readonly string[]).includes(value)
}

export function resolveKpiPeriod(key: KpiPeriodKey, now: Date = new Date()): KpiPeriod {
  const y = now.getFullYear()
  const m = now.getMonth()

  switch (key) {
    case "month": {
      const from = new Date(y, m, 1)
      const prevFrom = new Date(y, m - 1, 1)
      // Samme antall dager inn i forrige måned, men aldri forbi månedsskiftet
      // (31. mars har ingen «31. februar» å sammenlignes med).
      const prevTo = new Date(Math.min(prevFrom.getTime() + (now.getTime() - from.getTime()), from.getTime()))
      const buckets: KpiBucket[] = []
      const monthEnd = new Date(y, m + 1, 1)
      for (let day = 1; day <= now.getDate(); day += 7) {
        const bucketTo = new Date(Math.min(new Date(y, m, day + 7).getTime(), monthEnd.getTime()))
        const lastDay = new Date(bucketTo.getTime() - 1).getDate()
        buckets.push({ label: `${day}–${lastDay}`, from: new Date(y, m, day), to: bucketTo })
      }
      return {
        key,
        label: "Denne måneden",
        from,
        to: now,
        rangeText: formatRange(from, now),
        compare: { from: prevFrom, to: prevTo },
        compareText: `Mot samme dager i ${monthLong.format(prevFrom)}`,
        buckets,
      }
    }

    case "quarter": {
      const startMonth = Math.floor(m / 3) * 3
      const from = new Date(y, startMonth, 1)
      const prevFrom = new Date(y, startMonth - 3, 1)
      const prevTo = new Date(Math.min(prevFrom.getTime() + (now.getTime() - from.getTime()), from.getTime()))
      const buckets: KpiBucket[] = []
      for (let month = startMonth; month <= m; month++) {
        buckets.push({
          label: shortMonth(new Date(y, month, 1)),
          from: new Date(y, month, 1),
          to: new Date(y, month + 1, 1),
        })
      }
      return {
        key,
        label: "Dette kvartalet",
        from,
        to: now,
        rangeText: formatRange(from, now),
        compare: { from: prevFrom, to: prevTo },
        compareText: "Mot like langt inn i forrige kvartal",
        buckets,
      }
    }

    case "year": {
      const from = new Date(y, 0, 1)
      // «Hittil i år» mot samme dato i fjor — ni måneder mot et helt år ville
      // alltid sett ut som et fall.
      const prevTo = new Date(now)
      prevTo.setFullYear(y - 1)
      const buckets: KpiBucket[] = []
      for (let quarter = 0; quarter <= Math.floor(m / 3); quarter++) {
        buckets.push({
          label: `K${quarter + 1}`,
          from: new Date(y, quarter * 3, 1),
          to: new Date(y, quarter * 3 + 3, 1),
        })
      }
      return {
        key,
        label: "I år",
        from,
        to: now,
        rangeText: `Regnskapsåret ${y}, til og med i dag`,
        compare: { from: new Date(y - 1, 0, 1), to: prevTo },
        compareText: `Mot samme periode i ${y - 1}`,
        buckets,
      }
    }

    case "last12": {
      // Tolv hele månedssøyler: inneværende måned og de elleve før.
      const from = new Date(y, m - 11, 1)
      const prevTo = new Date(now)
      prevTo.setFullYear(y - 1)
      const buckets: KpiBucket[] = []
      for (let i = 0; i < 12; i++) {
        const start = new Date(y, m - 11 + i, 1)
        buckets.push({
          // Tolv søyler får bare plass til én bokstav hver.
          label: shortMonth(start).charAt(0).toUpperCase(),
          from: start,
          to: new Date(y, m - 10 + i, 1),
        })
      }
      return {
        key,
        label: "Siste 12 måneder",
        from,
        to: now,
        rangeText: formatRange(from, now),
        compare: { from: new Date(y - 1, m - 11, 1), to: prevTo },
        compareText: "Mot de tolv månedene før",
        buckets,
      }
    }

    case "lastYear": {
      const from = new Date(y - 1, 0, 1)
      const to = new Date(y, 0, 1)
      const buckets: KpiBucket[] = [0, 1, 2, 3].map((quarter) => ({
        label: `K${quarter + 1}`,
        from: new Date(y - 1, quarter * 3, 1),
        to: new Date(y - 1, quarter * 3 + 3, 1),
      }))
      return {
        key,
        label: "I fjor",
        from,
        to,
        rangeText: `Hele regnskapsåret ${y - 1}`,
        compare: { from: new Date(y - 2, 0, 1), to: from },
        compareText: `Mot ${y - 2}`,
        buckets,
      }
    }

    case "all":
      return {
        key,
        label: "Totalt",
        from: null,
        to: now,
        rangeText: "Alt som er registrert",
        compare: null,
        compareText: "Ingen sammenligning",
        buckets: null,
      }
  }
}

/** Hvor mange år «Totalt» viser som søyler — eldre år teller med i tallet, ikke i grafen. */
const MAX_YEAR_BUCKETS = 5

/**
 * Fordeler daterte rader på periodens søyler. `value` er beløpet for summer og
 * 1 for tellinger.
 */
export function bucketize(
  period: KpiPeriod,
  rows: ReadonlyArray<{ date: Date; value: number }>,
  now: Date = new Date()
): Array<{ label: string; value: number }> {
  let buckets = period.buckets
  if (!buckets) {
    const thisYear = now.getFullYear()
    const earliest = rows.reduce((min, row) => Math.min(min, row.date.getFullYear()), thisYear)
    const firstYear = Math.max(earliest, thisYear - (MAX_YEAR_BUCKETS - 1))
    buckets = []
    for (let year = firstYear; year <= thisYear; year++) {
      buckets.push({ label: `${year}`, from: new Date(year, 0, 1), to: new Date(year + 1, 0, 1) })
    }
  }

  const points = buckets.map((bucket) => ({ label: bucket.label, value: 0 }))
  for (const row of rows) {
    const index = buckets.findIndex((bucket) => row.date >= bucket.from && row.date < bucket.to)
    if (index >= 0) points[index].value += row.value
  }
  return points
}
