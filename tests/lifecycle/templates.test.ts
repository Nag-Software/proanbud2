import { describe, expect, it } from "vitest"

import { LIFECYCLE_TEMPLATES } from "@/lib/lifecycle/onboarding-templates"

const base = { recipientName: "Kari", companyName: "Testbygg AS", promoCode: null as string | null }

describe("LIFECYCLE_TEMPLATES", () => {
  it("velkomst: har emne, CTA til nytt tilbud og viser promo-koden når den finnes", () => {
    const t = LIFECYCLE_TEMPLATES.velkomst
    expect(t.id).toBe("lifecycle-velkomst")
    expect(t.subject.length).toBeGreaterThan(0)
    const html = t.buildHtml({ ...base, promoCode: "VELKOMMEN-KARI" })
    expect(html).toContain("Velkommen")
    expect(html).toContain("/nytt-tilbud")
    expect(html).toContain("VELKOMMEN-KARI")
    expect(html).toContain("Testbygg AS")
  })

  it("aktivering: peker på nytt tilbud og nevner ikke promo (ingen kode gitt)", () => {
    const html = LIFECYCLE_TEMPLATES.aktivering.buildHtml(base)
    expect(html).toContain("/nytt-tilbud")
    expect(html).not.toContain("Velkomstbonus")
  })

  it("verdi: viser antall tilbud og pipeline-verdi når det finnes arbeid", () => {
    const html = LIFECYCLE_TEMPLATES.verdi.buildHtml({
      ...base,
      stats: { offerCount: 3, pipelineNok: 125000 },
    })
    expect(html).toContain("3")
    expect(html).toMatch(/125\s?000/) // «125 000 kr» med norsk tusenskille
  })

  it("verdi: faller pent tilbake uten arbeid (ingen tall å vise)", () => {
    const html = LIFECYCLE_TEMPLATES.verdi.buildHtml({ ...base, stats: { offerCount: 0, pipelineNok: 0 } })
    expect(html).toContain("/nytt-tilbud")
  })

  it("winback: lenker til betaling og viser promo-koden", () => {
    const html = LIFECYCLE_TEMPLATES.winback.buildHtml({ ...base, promoCode: "VELKOMMEN-KARI" })
    expect(html).toContain("/innstillinger/betaling")
    expect(html).toContain("VELKOMMEN-KARI")
  })

  it("alle malene bygger uten å kaste, med og uten firmanavn", () => {
    for (const key of ["velkomst", "aktivering", "verdi", "winback"] as const) {
      expect(() => LIFECYCLE_TEMPLATES[key].buildHtml({ recipientName: "der", companyName: null, promoCode: null })).not.toThrow()
    }
  })
})
