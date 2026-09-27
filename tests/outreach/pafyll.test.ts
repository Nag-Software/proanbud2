import { describe, expect, it } from "vitest"

import { refillDecision, REFILL_MAX_PER_DAY } from "@/lib/outreach/pafyll-regler"

const now = new Date("2026-09-27T09:00:00Z")

describe("påfyll", () => {
  it("henter når maskinen er i ferd med å gå tom", () => {
    const decision = refillDecision({ fuel: 0, capacity: 30, lastRefillAt: null, refillsToday: 0, now })
    expect(decision.refill).toBe(true)
  })

  it("lar være når det er nok å jobbe med", () => {
    expect(refillDecision({ fuel: 30, capacity: 30, lastRefillAt: null, refillsToday: 0, now }).refill).toBe(false)
  })

  it("venter tre timer mellom to automatiske porsjoner", () => {
    const twoHoursAgo = new Date(now.getTime() - 2 * 3_600_000).toISOString()
    const fourHoursAgo = new Date(now.getTime() - 4 * 3_600_000).toISOString()
    expect(refillDecision({ fuel: 0, capacity: 30, lastRefillAt: twoHoursAgo, refillsToday: 1, now }).refill).toBe(false)
    expect(refillDecision({ fuel: 0, capacity: 30, lastRefillAt: fourHoursAgo, refillsToday: 1, now }).refill).toBe(true)
  })

  it("«Kjør nå» venter ikke, men døgntaket gjelder alltid", () => {
    const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString()
    expect(
      refillDecision({ fuel: 0, capacity: 30, lastRefillAt: tenMinutesAgo, refillsToday: 1, now, manual: true }).refill,
    ).toBe(true)
    expect(
      refillDecision({
        fuel: 0,
        capacity: 30,
        lastRefillAt: tenMinutesAgo,
        refillsToday: REFILL_MAX_PER_DAY,
        now,
        manual: true,
      }).refill,
    ).toBe(false)
  })

  it("er av når «nye utkast per dag» står på 0", () => {
    expect(refillDecision({ fuel: 0, capacity: 0, lastRefillAt: null, refillsToday: 0, now }).refill).toBe(false)
  })
})
