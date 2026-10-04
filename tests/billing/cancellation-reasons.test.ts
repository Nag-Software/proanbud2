import { describe, expect, it } from "vitest"

import {
  CANCELLATION_REASONS,
  reasonRequiresDetail,
  validateCancellationAnswer,
} from "@/lib/billing/cancellation-reasons"

describe("validateCancellationAnswer", () => {
  it("krever en grunn", () => {
    expect(validateCancellationAnswer({}).ok).toBe(false)
    expect(validateCancellationAnswer(null).ok).toBe(false)
    expect(validateCancellationAnswer({ reason: null, detail: "" }).ok).toBe(false)
  })

  it("avviser ukjente grunner", () => {
    expect(validateCancellationAnswer({ reason: "noe_annet" }).ok).toBe(false)
  })

  it("godtar «For dyrt» uten utdypning og kaster fritekst som ikke hører hjemme", () => {
    expect(validateCancellationAnswer({ reason: "pris", detail: "bare tull" })).toEqual({
      ok: true,
      answer: { reason: "pris", detail: null },
    })
  })

  it.each(["mangler_funksjon", "vanskelig", "byttet_system", "tekniske_feil", "annet"] as const)(
    "krever utdypning for %s",
    (reason) => {
      expect(reasonRequiresDetail(reason)).toBe(true)
      expect(validateCancellationAnswer({ reason }).ok).toBe(false)
      expect(validateCancellationAnswer({ reason, detail: "   " }).ok).toBe(false)
      expect(validateCancellationAnswer({ reason, detail: "  Tripletex  " })).toEqual({
        ok: true,
        answer: { reason, detail: "Tripletex" },
      })
    }
  )

  it("har unike nøkler", () => {
    const keys = CANCELLATION_REASONS.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
