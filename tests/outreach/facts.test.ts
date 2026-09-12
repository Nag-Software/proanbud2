import { describe, expect, it } from "vitest"

import { PLAN_PRICING, MODULE_PRICING, TRIAL_DAYS } from "@/lib/billing/plans"
import {
  FACTS,
  factsForPrompt,
  findBannedClaims,
  findBannedWords,
  verifiedFacts,
} from "@/lib/outreach/facts"

describe("faktaarket", () => {
  it("prisene kommer fra plans.ts — aldri hardkodet", () => {
    const text = FACTS.map((fact) => fact.text).join(" ")
    expect(text).toContain(`${PLAN_PRICING.mini.year.monthlyNok} kr`)
    expect(text).toContain(`${PLAN_PRICING.proff.month.monthlyNok} kr`)
    expect(text).toContain(`${MODULE_PRICING.integrasjoner} kr`)
    expect(text).toContain(`${TRIAL_DAYS} dager`)
  })

  it("faktura via regnskap krever at integrasjonsprisen også nevnes (Mini betaler ekstra)", () => {
    const faktura = FACTS.find((fact) => fact.id === "faktura_regnskap")
    expect(faktura?.requires).toContain("integrasjon_pris")
  })

  it("uverifiserte påstander når aldri prompten", () => {
    const prompt = factsForPrompt("handverker")
    for (const fact of FACTS.filter((f) => !f.verified)) {
      expect(prompt).not.toContain(fact.text)
    }
    expect(verifiedFacts().every((fact) => fact.verified)).toBe(true)
  })

  it("partnerfakta vises bare for partnersegmentet", () => {
    expect(factsForPrompt("handverker")).not.toContain("partner_provisjon")
    expect(factsForPrompt("regnskapspartner")).toContain("partner_provisjon")
  })

  it("ingen verifisert påstand bryter egne forbud", () => {
    for (const fact of verifiedFacts()) {
      expect(findBannedClaims(fact.text), fact.id).toEqual([])
      expect(findBannedWords(fact.text), fact.id).toEqual([])
    }
  })
})

describe("forbud", () => {
  it("fanger de kjente feilpåstandene", () => {
    expect(findBannedClaims("Over 5200+ tilbud generert")).toHaveLength(1)
    expect(findBannedClaims("Data på norske servere")).toHaveLength(1)
    expect(findBannedClaims("Signer med DocuSign")).toHaveLength(1)
    expect(findBannedClaims("Tilbudet er KI-generert")).toHaveLength(1)
  })

  it("fanger konsulentord, men ikke ord som bare ligner", () => {
    expect(findBannedWords("En komplett løsning for deg")).toEqual(["løsning"])
    expect(findBannedWords("Vi hjelper med digitalisering")).toEqual(["digitalisering"])
    expect(findBannedWords("Vi løser tilbudene")).toEqual([])
  })
})
