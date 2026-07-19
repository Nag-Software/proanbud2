import { describe, expect, it } from "vitest"

import { TRIAL_TEMPLATES } from "@/lib/billing/trial-reminder-templates"
import { WELCOME_DISCOUNT_PERCENT } from "@/lib/billing/welcome-discount"

const KINDS = ["soon", "lastDay", "expired"] as const

function render(kind: (typeof KINDS)[number], promoCode: string | null) {
  return TRIAL_TEMPLATES[kind].buildHtml({
    recipientName: "Ola",
    companyName: "Ola Bygg AS",
    promoCode,
  })
}

describe("trial reminder e-poster", () => {
  // Prøven er KORTFRI: uten kort stopper tilgangen ved utløp. E-posten lovet
  // tidligere det motsatte («du blir ikke belastet før prøveperioden er over»,
  // som impliserte at den fortsatte av seg selv).
  it.each(KINDS)("%s lover ikke automatisk fortsettelse uten kort", (kind) => {
    const html = render(kind, "VELKOMST-ABC123")
    expect(html).not.toContain("Du blir ikke belastet før prøveperioden faktisk er over")
    expect(html.toLowerCase()).toContain("betalingskort")
  })

  it.each(KINDS)("%s viser velkomstkoden når den finnes", (kind) => {
    const html = render(kind, "VELKOMST-ABC123")
    expect(html).toContain("VELKOMST-ABC123")
    expect(html).toContain(`${WELCOME_DISCOUNT_PERCENT} %`)
    // 80 % av 499 kr → 100 kr første måned.
    expect(html).toContain("100 kr")
  })

  it.each(KINDS)("%s sendes fortsatt ut uten kode", (kind) => {
    const html = render(kind, null)
    expect(html).not.toContain("VELKOMST-")
    expect(html).not.toContain("Velkomstbonus")
    expect(html).toContain("Ola")
  })
})
