import { describe, expect, it } from "vitest"

import { resolveBransje } from "@/lib/outreach/bransje"
import { getDefaultImportNace } from "@/lib/outreach/import"
import { getSegment, resolveTrade } from "@/lib/outreach/segments"

// Kodene og beskrivelsene er slik Brønnøysund returnerer dem i SN2025 (2026-09-11).
describe("resolveTrade (SN2025)", () => {
  it.each([
    ["41.000", "Oppføring av bygninger", "bygg"],
    ["43.210", "Elektrisk installasjonsarbeid", "elektro"],
    ["43.221", "Rørleggerarbeid", "ror"],
    ["43.222", "Kuldeanlegg-, varmepumpearbeid og installasjon av peiser", "varmepumpe"],
    ["43.223", "Ventilasjonsarbeid", "ventilasjon"],
    ["43.320", "Snekkerarbeid", "snekker"],
    ["43.330", "Gulvlegging og tapetsering", "gulv"],
    ["43.340", "Maler- og glassarbeid", "maler"],
    ["43.410", "Takarbeid", "tak"],
    ["43.910", "Murerarbeid", "mur"],
    ["43.120", "Grunnarbeid", "grunnarbeid"],
    ["69.202", "Regnskapsføring og bokføring", "regnskap"],
  ])("%s %s → %s", (code, description, expected) => {
    expect(resolveTrade({ naceCode: code, naceDescription: description })).toBe(expected)
  })

  it("stoler på beskrivelsen når sifrene er tvetydige mellom SN2007 og SN2025", () => {
    // 43.910 var takarbeid i SN2007, men er murerarbeid i SN2025.
    expect(resolveTrade({ naceCode: "43.910", naceDescription: "Murerarbeid" })).toBe("mur")
    expect(resolveTrade({ naceCode: "43.910", naceDescription: "Takarbeid" })).toBe("tak")
  })

  it("faller tilbake til koden når beskrivelsen mangler", () => {
    expect(resolveTrade({ naceCode: "43.340" })).toBe("maler")
    expect(resolveTrade({ naceCode: null })).toBe("annet")
  })
})

describe("resolveBransje (eksempeltilbud)", () => {
  it("sender murere til bygg-eksempelet, ikke tak", () => {
    expect(resolveBransje({ naceCode: "43.910", naceDescription: "Murerarbeid" })).toBe("bygg")
  })

  it("mapper SN2025-fag til riktig eksempel", () => {
    expect(resolveBransje({ naceCode: "43.410", naceDescription: "Takarbeid" })).toBe("tak")
    expect(resolveBransje({ naceCode: "43.221", naceDescription: "Rørleggerarbeid" })).toBe("rorlegger")
    expect(resolveBransje({ naceCode: "43.320", naceDescription: "Snekkerarbeid" })).toBe("tomrer")
    expect(resolveBransje({ naceCode: "41.000", naceDescription: "Oppføring av bygninger" })).toBe("bygg")
  })
})

describe("import-standarder", () => {
  it("bruker SN2025-prefikser som faktisk gir treff i Brreg", () => {
    const previous = process.env.OUTREACH_IMPORT_NACE
    delete process.env.OUTREACH_IMPORT_NACE
    expect(getDefaultImportNace()).toEqual(["41", "43"])
    process.env.OUTREACH_IMPORT_NACE = "43,41.2"
    expect(getDefaultImportNace()).toEqual(["43", "41"])
    if (previous === undefined) delete process.env.OUTREACH_IMPORT_NACE
    else process.env.OUTREACH_IMPORT_NACE = previous
  })

  it("håndverkersegmentet er AS med 5–20 ansatte", () => {
    const segment = getSegment("handverker")
    expect(segment.orgForms).toContain("AS")
    expect(segment.orgForms).not.toContain("ENK")
    expect([segment.fraAntallAnsatte, segment.tilAntallAnsatte]).toEqual([5, 20])
  })
})
