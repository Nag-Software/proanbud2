import { describe, expect, it, vi } from "vitest"

import { readProjectSummaryFromAnalysis } from "@/lib/tilbud/project-summary.shared"

describe("readProjectSummaryFromAnalysis", () => {
  it("leser sammendraget fra analysen", () => {
    expect(readProjectSummaryFromAnalysis({ summary: "  Nytt bad i 2. etasje.  " })).toBe("Nytt bad i 2. etasje.")
  })

  it("gir tom tekst uten analyse eller sammendrag", () => {
    expect(readProjectSummaryFromAnalysis(null)).toBe("")
    expect(readProjectSummaryFromAnalysis({})).toBe("")
    expect(readProjectSummaryFromAnalysis({ summary: 42 })).toBe("")
  })

  it("viser ikke plassholderen til manuelle tilbud som innledning for kunden", () => {
    // Eldre manuelle tilbud har denne teksten lagret som sammendrag.
    expect(readProjectSummaryFromAnalysis({ summary: "Manuell kalkyle uten AI-analyse", model: "manual" })).toBe("")
  })
})

vi.mock("server-only", () => ({}))
vi.mock("@/lib/errors/log", () => ({ logServerError: vi.fn() }))

describe("buildFallbackProjectSummary", () => {
  const lineItem = (subproject: string, title: string) => ({
    id: title,
    subproject,
    title,
    description: "",
    quantity: 1,
    unit: "stk",
    supplier: "",
    unitPriceNok: 100,
    markupPercent: 0,
    discountPercent: 0,
  })

  it("bruker håndverkerens jobbeskrivelse før kategoriene", async () => {
    const { buildFallbackProjectSummary } = await import("@/lib/tilbud/project-summary")
    expect(
      buildFallbackProjectSummary({
        title: "Totalrenovering bad",
        description: "Riving av gammelt bad, ny membran og flislegging.",
        projectName: "Nytt bad",
        lineItems: [lineItem("Flis og membran", "Membran")],
      })
    ).toBe("Riving av gammelt bad, ny membran og flislegging.")
  })

  it("lister ikke standardkategorien «Generelt» som arbeid", async () => {
    const { buildFallbackProjectSummary } = await import("@/lib/tilbud/project-summary")
    expect(
      buildFallbackProjectSummary({
        title: "Totalrenovering bad",
        description: "",
        projectName: "Nytt bad",
        lineItems: [lineItem("Generelt", "Riving"), lineItem("Flis og membran", "Membran")],
      })
    ).toBe("Tilbud for Nytt bad med arbeider som blant annet omfatter Flis og membran.")
  })
})
