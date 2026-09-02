import { describe, expect, it } from "vitest"

import {
  MODULES_INCLUDED_IN_PROFF,
  MODULE_PRICING,
  PLAN_PRICING,
  PLAN_QUOTA_LIMITS,
  PROFF_INCLUDED_FEATURES,
  SEAT_PRICE_NOK,
  hasFeature,
  hasModule,
  INCLUDED_SEATS_BY_PLAN,
} from "@/lib/billing/plans"

describe("hasModule — timeføring inngår i Proff", () => {
  it("gir Proff timeføring uten kjøpt modul", () => {
    expect(hasModule("proff", [], "timeforing")).toBe(true)
    expect(hasModule("proff", ["kjorebok"], "timeforing")).toBe(true)
  })

  it("krever fortsatt kjøpt modul på Mini", () => {
    expect(hasModule("mini", [], "timeforing")).toBe(false)
    expect(hasModule("mini", ["timeforing"], "timeforing")).toBe(true)
  })

  it("lar eksisterende Proff med 39 kr-tillegg fortsatt ha timer", () => {
    expect(hasModule("proff", ["timeforing"], "timeforing")).toBe(true)
  })

  it("lar kjørebok være tillegg på begge planer", () => {
    expect(hasModule("proff", [], "kjorebok")).toBe(false)
    expect(hasModule("mini", [], "kjorebok")).toBe(false)
    expect(hasModule("proff", ["kjorebok"], "kjorebok")).toBe(true)
    expect(hasModule("mini", ["kjorebok"], "kjorebok")).toBe(true)
  })

  it("lar dokumenter være tillegg på begge planer", () => {
    expect(hasModule("proff", [], "dokumenter")).toBe(false)
    expect(hasModule("mini", ["dokumenter"], "dokumenter")).toBe(true)
  })

  it("gir ikke tilgang uten plan og uten kjøpt modul", () => {
    expect(hasModule(null, [], "timeforing")).toBe(false)
    expect(hasModule(undefined, ["timeforing"], "timeforing")).toBe(true)
  })
})

describe("plan catalog — uendrede priser og grenser", () => {
  it("holder Mini- og Proff-pris uendret", () => {
    expect(PLAN_PRICING.mini.year.monthlyNok).toBe(189)
    expect(PLAN_PRICING.proff.year.monthlyNok).toBe(419)
    expect(PLAN_PRICING.mini.month.monthlyNok).toBe(229)
    expect(PLAN_PRICING.proff.month.monthlyNok).toBe(499)
  })

  it("holder seter, kvote og timeføring-tilleggspris uendret", () => {
    expect(INCLUDED_SEATS_BY_PLAN.mini).toBe(0)
    expect(INCLUDED_SEATS_BY_PLAN.proff).toBe(5)
    expect(PLAN_QUOTA_LIMITS.mini).toBe(20)
    expect(PLAN_QUOTA_LIMITS.proff).toBe(100)
    expect(SEAT_PRICE_NOK).toBe(39)
    expect(MODULE_PRICING.timeforing).toBe(39)
    expect(MODULE_PRICING.kjorebok).toBe(49)
  })

  it("lister timeføring som inkludert i Proff, men ikke kjørebok", () => {
    expect(MODULES_INCLUDED_IN_PROFF).toContain("timeforing")
    expect(MODULES_INCLUDED_IN_PROFF).not.toContain("kjorebok")
    expect(PROFF_INCLUDED_FEATURES.some((f) => f.key === "timeforing")).toBe(true)
  })

  it("endrer ikke HMS/integrasjoner-feature-gating", () => {
    expect(hasFeature("proff", [], "hms")).toBe(true)
    expect(hasFeature("mini", [], "hms")).toBe(false)
    expect(hasFeature("proff", [], "integrasjoner")).toBe(true)
    expect(hasFeature("mini", [], "integrasjoner")).toBe(false)
    expect(hasFeature("mini", ["integrasjoner"], "integrasjoner")).toBe(true)
  })
})
