import { describe, expect, it } from "vitest"

import { KPI_PERIOD_KEYS, bucketize, resolveKpiPeriod } from "@/app/dashboard-kpi-periods"

// 30. september 2026 kl. 12 — midt i K3.
const NOW = new Date(2026, 8, 30, 12, 0, 0)

describe("resolveKpiPeriod", () => {
  it("«I år» går fra 1. januar og måles mot samme dato i fjor", () => {
    const period = resolveKpiPeriod("year", NOW)
    expect(period.from).toEqual(new Date(2026, 0, 1))
    expect(period.compare).toEqual({ from: new Date(2025, 0, 1), to: new Date(2025, 8, 30, 12, 0, 0) })
    expect(period.buckets?.map((bucket) => bucket.label)).toEqual(["K1", "K2", "K3"])
  })

  it("måneden måles mot like mange dager i forrige måned, aldri forbi månedsskiftet", () => {
    const period = resolveKpiPeriod("month", new Date(2026, 2, 31, 12, 0, 0))
    expect(period.compare?.from).toEqual(new Date(2026, 1, 1))
    // Februar har 28 dager — sammenligningen stopper ved 1. mars.
    expect(period.compare?.to).toEqual(new Date(2026, 2, 1))
    expect(period.buckets?.map((bucket) => bucket.label)).toEqual(["1–7", "8–14", "15–21", "22–28", "29–31"])
  })

  it("«Siste 12 måneder» har tolv månedssøyler som slutter i inneværende måned", () => {
    const period = resolveKpiPeriod("last12", NOW)
    expect(period.from).toEqual(new Date(2025, 9, 1))
    expect(period.buckets).toHaveLength(12)
    expect(period.buckets?.at(-1)?.from).toEqual(new Date(2026, 8, 1))
  })

  it("«I fjor» er hele fjoråret, og «Totalt» har ingen sammenligning", () => {
    const lastYear = resolveKpiPeriod("lastYear", NOW)
    expect([lastYear.from, lastYear.to]).toEqual([new Date(2025, 0, 1), new Date(2026, 0, 1)])
    expect(resolveKpiPeriod("all", NOW).compare).toBeNull()
  })

  it("søylene dekker hele perioden uten hull eller overlapp", () => {
    for (const key of KPI_PERIOD_KEYS) {
      const { buckets, from, to } = resolveKpiPeriod(key, NOW)
      if (!buckets || !from) continue
      expect(buckets[0].from).toEqual(from)
      for (let i = 1; i < buckets.length; i++) expect(buckets[i].from).toEqual(buckets[i - 1].to)
      expect(buckets.at(-1)!.to.getTime()).toBeGreaterThanOrEqual(to.getTime())
    }
  })
})

describe("bucketize", () => {
  it("summerer rader i riktig kvartal", () => {
    const points = bucketize(
      resolveKpiPeriod("year", NOW),
      [
        { date: new Date(2026, 1, 10), value: 100 },
        { date: new Date(2026, 8, 1), value: 40 },
        { date: new Date(2026, 8, 29), value: 2 },
      ],
      NOW
    )
    expect(points).toEqual([
      { label: "K1", value: 100 },
      { label: "K2", value: 0 },
      { label: "K3", value: 42 },
    ])
  })

  it("«Totalt» gir én søyle per år, maks fem", () => {
    const points = bucketize(
      resolveKpiPeriod("all", NOW),
      [
        { date: new Date(2019, 5, 1), value: 1 },
        { date: new Date(2025, 5, 1), value: 1 },
        { date: new Date(2026, 5, 1), value: 1 },
      ],
      NOW
    )
    expect(points.map((point) => point.label)).toEqual(["2022", "2023", "2024", "2025", "2026"])
    expect(points.at(-1)?.value).toBe(1)
  })
})
