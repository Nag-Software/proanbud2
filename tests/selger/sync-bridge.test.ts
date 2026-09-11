import { describe, expect, it } from "vitest"

import { reconcileProspectStatus } from "@/lib/selger/billing-transition"

describe("reconcileProspectStatus", () => {
  it("prøve → kunde når de betaler, logget som vunnet", () => {
    expect(reconcileProspectStatus("trial", "active")).toEqual({ status: "kunde", outcome: "won" })
    expect(reconcileProspectStatus("trial", "past_due")).toEqual({ status: "kunde", outcome: "won" })
  })

  it("en tapt som kommer tilbake og betaler blir kunde", () => {
    expect(reconcileProspectStatus("tapt", "active")).toEqual({ status: "kunde", outcome: "won" })
  })

  it("prøve som går ut uten kjøp → tapt", () => {
    expect(reconcileProspectStatus("trial", "canceled")).toEqual({ status: "tapt", outcome: "lost" })
    expect(reconcileProspectStatus("trial", "incomplete_expired")).toEqual({ status: "tapt", outcome: "lost" })
  })

  it("rører ikke leads Casper har flyttet selv når prøven går ut", () => {
    expect(reconcileProspectStatus("demo", "canceled")).toBeNull()
    expect(reconcileProspectStatus("kunde", "canceled")).toBeNull()
  })

  it("åpne leads går til prøve når de starter prøven, lukkede gjør ikke", () => {
    expect(reconcileProspectStatus("dialog", "trialing")).toEqual({ status: "trial", outcome: null })
    expect(reconcileProspectStatus("kunde", "trialing")).toBeNull()
    expect(reconcileProspectStatus("trial", "trialing")).toBeNull()
  })

  it("ingen endring når kunden allerede er kunde", () => {
    expect(reconcileProspectStatus("kunde", "active")).toBeNull()
  })
})
