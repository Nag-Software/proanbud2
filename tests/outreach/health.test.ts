import { describe, expect, it } from "vitest"

import {
  BOUNCE_THRESHOLD,
  COMPLAINT_THRESHOLD,
  evaluateHealth,
  MIN_SAMPLE,
} from "@/lib/outreach/health-rules"

describe("evaluateHealth", () => {
  it("sier ingenting før utvalget er stort nok", () => {
    // Én bounce av tre er 33 %, men tre sendinger er ikke et signal.
    expect(evaluateHealth({ sampled: 3, bounced: 1, complained: 0 })).toEqual({
      healthy: true,
      reason: null,
    })
    expect(evaluateHealth({ sampled: MIN_SAMPLE - 1, bounced: 5, complained: 3 }).healthy).toBe(true)
  })

  it("pauser på én eneste klage", () => {
    const result = evaluateHealth({ sampled: 50, bounced: 0, complained: COMPLAINT_THRESHOLD })
    expect(result.healthy).toBe(false)
    expect(result.reason).toBe("klage")
  })

  it("pauser når harde returer går over terskelen", () => {
    // 2 av 50 = 4 %, over 3 %.
    const result = evaluateHealth({ sampled: 50, bounced: 2, complained: 0 })
    expect(result.healthy).toBe(false)
    expect(result.reason).toBe("bounce")
  })

  it("lar en enkelt retur i et stort utvalg passere", () => {
    // 1 av 50 = 2 %, under terskelen.
    expect(evaluateHealth({ sampled: 50, bounced: 1, complained: 0 }).healthy).toBe(true)
  })

  it("er nøyaktig på terskelen — den skal være «over», ikke «lik»", () => {
    const atThreshold = Math.round(50 * BOUNCE_THRESHOLD) // 2 av 50 = 4 %
    expect(evaluateHealth({ sampled: 50, bounced: atThreshold - 1, complained: 0 }).healthy).toBe(
      true,
    )
  })

  it("er sunt når alt går bra", () => {
    expect(evaluateHealth({ sampled: 50, bounced: 0, complained: 0 })).toEqual({
      healthy: true,
      reason: null,
    })
  })
})
