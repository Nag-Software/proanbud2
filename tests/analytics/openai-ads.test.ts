import { describe, expect, it } from "vitest"

import { hasMeasurementConsent } from "@/lib/analytics/openai-ads"

/**
 * Samtykkeregelen er den ene tingen her som MÅ være riktig: bare et
 * uttrykkelig «denied» slår av måling. Har brukeren ikke tatt stilling
 * (ingen cookie), måler vi.
 */
describe("hasMeasurementConsent", () => {
  it("måler når brukeren ikke har tatt stilling", () => {
    expect(hasMeasurementConsent(null)).toBe(true)
    expect(hasMeasurementConsent("")).toBe(true)
  })

  it("måler ved uttrykkelig samtykke", () => {
    expect(hasMeasurementConsent("granted")).toBe(true)
  })

  it("slår av måling KUN ved uttrykkelig «denied»", () => {
    expect(hasMeasurementConsent("denied")).toBe(false)
    expect(hasMeasurementConsent(" DENIED ")).toBe(false)
  })

  it("tolker ukjente verdier som «ikke tatt stilling», ikke som nei", () => {
    expect(hasMeasurementConsent("noe-annet")).toBe(true)
  })
})
