import { describe, expect, it } from "vitest"

import { createFreshnessTracker, isStale, type PageStamp } from "@/lib/perf/freshness"

describe("freshness", () => {
  it("regner alder riktig selv når klientens klokke går feil", () => {
    // Klienten ligger 7 minutter foran serveren.
    const skew = 7 * 60_000
    const tracker = createFreshnessTracker()
    const serverNow = 1_000_000_000

    // Første side (ferskt rendret) etablerer avviket.
    tracker.observe(serverNow, serverNow + skew + 150)
    // En forvarmet side rendret for 4 minutter siden vises nå.
    const warmedAt = serverNow - 4 * 60_000
    const clientNow = serverNow + skew + 200
    tracker.observe(warmedAt, clientNow)
    expect(tracker.ageOf(warmedAt, clientNow)).toBeGreaterThanOrEqual(4 * 60_000)
    expect(tracker.ageOf(warmedAt, clientNow)).toBeLessThan(4 * 60_000 + 1_000)
  })

  it("lærer av en ferskere observasjon", () => {
    const tracker = createFreshnessTracker()
    // Første side kom tregt (2 s forsinkelse fra render til visning).
    tracker.observe(0, 2_000)
    expect(tracker.ageOf(10_000, 12_000)).toBe(0)
    // En side vist 100 ms etter render senker estimatet.
    tracker.observe(20_000, 20_100)
    expect(tracker.ageOf(30_000, 32_000)).toBe(1_900)
  })

  it("aldri negativ alder", () => {
    const tracker = createFreshnessTracker()
    tracker.observe(0, 500)
    expect(tracker.ageOf(1_000, 1_100)).toBe(0)
  })

  it("friskes bare opp for siden brukeren står på, og bare når vinduet er passert", () => {
    const stamp: PageStamp = { pathname: "/tilbud", renderedAt: 0, freshForMs: 30_000 }
    expect(isStale(stamp, "/tilbud", 30_001)).toBe(true)
    expect(isStale(stamp, "/tilbud", 30_000)).toBe(false)
    expect(isStale(stamp, "/kunder", 999_999)).toBe(false)
    expect(isStale(null, "/tilbud", 999_999)).toBe(false)
  })
})
