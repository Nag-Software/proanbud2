import { describe, expect, it } from "vitest"

import { DAY_MS, pickLifecycleEmail, type LifecycleInput } from "@/lib/lifecycle/schedule"

const NOW = Date.UTC(2026, 7, 4, 10, 0, 0) // fast referansetidspunkt

function input(over: Partial<LifecycleInput> & { ageDays: number }): LifecycleInput {
  const { ageDays, ...rest } = over
  return {
    now: NOW,
    signupAtMs: NOW - ageDays * DAY_MS,
    status: "trialing",
    trialEndsAtMs: null,
    hasSentOffer: false,
    hasPaid: false,
    ...rest,
  }
}

describe("pickLifecycleEmail", () => {
  it("dag 0–1 i prøve → velkomst", () => {
    expect(pickLifecycleEmail(input({ ageDays: 0 }))).toBe("velkomst")
    expect(pickLifecycleEmail(input({ ageDays: 1.5 }))).toBe("velkomst")
  })

  it("dag 3–6 uten sendt tilbud → aktivering", () => {
    expect(pickLifecycleEmail(input({ ageDays: 3 }))).toBe("aktivering")
    expect(pickLifecycleEmail(input({ ageDays: 6 }))).toBe("aktivering")
  })

  it("dag 3–6 MEN tilbud allerede sendt → ingenting (aktivering hoppes over)", () => {
    expect(pickLifecycleEmail(input({ ageDays: 4, hasSentOffer: true }))).toBeNull()
  })

  it("dag 7–9 er et bevisst gap → ingenting", () => {
    expect(pickLifecycleEmail(input({ ageDays: 8 }))).toBeNull()
  })

  it("dag 10–20 → verdi-oppsummering", () => {
    expect(pickLifecycleEmail(input({ ageDays: 10 }))).toBe("verdi")
    expect(pickLifecycleEmail(input({ ageDays: 14, hasSentOffer: true }))).toBe("verdi")
  })

  it("utløpt prøve, ikke betalt, 5–12 dager siden → win-back (uansett status)", () => {
    const base = { ageDays: 21, status: "canceled", trialEndsAtMs: NOW - 7 * DAY_MS }
    expect(pickLifecycleEmail(input(base))).toBe("winback")
  })

  it("win-back for tidlig (2 dager siden utløp) → ingenting", () => {
    expect(
      pickLifecycleEmail(input({ ageDays: 16, status: "canceled", trialEndsAtMs: NOW - 2 * DAY_MS }))
    ).toBeNull()
  })

  it("win-back for sent (20 dager siden utløp) → ingenting", () => {
    expect(
      pickLifecycleEmail(input({ ageDays: 34, status: "canceled", trialEndsAtMs: NOW - 20 * DAY_MS }))
    ).toBeNull()
  })

  it("betalende bedrift får aldri win-back", () => {
    expect(
      pickLifecycleEmail(input({ ageDays: 21, status: "active", hasPaid: true, trialEndsAtMs: NOW - 7 * DAY_MS }))
    ).toBeNull()
  })

  it("ikke-prøve-status uten utløp → ingenting", () => {
    expect(pickLifecycleEmail(input({ ageDays: 1, status: "past_due" }))).toBeNull()
  })
})
