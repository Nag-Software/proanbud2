import { describe, expect, it } from "vitest"

import { startOfOsloDayIso } from "@/lib/outreach/send"

describe("startOfOsloDayIso", () => {
  it("sommertid: midnatt i Oslo er 22:00 UTC dagen før", () => {
    // 11. sept. 2026 kl. 01:30 i Oslo = 10. sept. 23:30 UTC
    expect(startOfOsloDayIso(new Date("2026-09-10T23:30:00Z"))).toBe("2026-09-10T22:00:00.000Z")
    // Midt på dagen samme dato
    expect(startOfOsloDayIso(new Date("2026-09-11T12:00:00Z"))).toBe("2026-09-10T22:00:00.000Z")
  })

  it("vintertid: midnatt i Oslo er 23:00 UTC dagen før", () => {
    expect(startOfOsloDayIso(new Date("2026-01-15T10:00:00Z"))).toBe("2026-01-14T23:00:00.000Z")
  })

  it("rett etter midnatt UTC er det fortsatt samme Oslo-dag som startet 22:00", () => {
    expect(startOfOsloDayIso(new Date("2026-09-11T00:10:00Z"))).toBe("2026-09-10T22:00:00.000Z")
  })
})
