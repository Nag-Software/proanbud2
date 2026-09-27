import { renderToString } from "react-dom/server"
import { describe, expect, it } from "vitest"

import TilbudTab from "../../app/prosjekter/[id]/tilbud-tab"

// Prosjektsiden er en serverkomponent, så fanen rendres først på serveren.
// Her finnes verken window eller document.
const TILBUD = [
  {
    id: "fjos",
    title: "Sauefjøs komplett",
    description: null,
    amount_nok: 8_320_929,
    status: "draft",
    created_at: "2026-09-06T12:00:00Z",
    analysis_result: { summary: "Komplett budsjettkalkyle for nytt fjøs." },
  },
  {
    id: "riving",
    title: "Riving av låve",
    description: null,
    amount_nok: 1_245_000,
    status: "sent",
    created_at: "2026-08-28T12:00:00Z",
    analysis_result: null,
  },
]

function renderPaServer(readOnly = false) {
  return renderToString(
    <TilbudTab projectId="p1" projectName="Nytt fjøs" customerName="Kunde AS" offers={TILBUD} readOnly={readOnly} />
  )
}

describe("Tilbud-fanen på serveren", () => {
  it("rendres uten nettleser-API-er", () => {
    expect(typeof window).toBe("undefined")
    expect(() => renderPaServer()).not.toThrow()
  })

  it("har kortene, beløpene og lenkene med i HTML-en fra serveren", () => {
    const html = renderPaServer()
    expect(html).toContain("Sauefjøs komplett")
    expect(html).toContain("8 320 929 kr")
    expect(html).toContain('href="/tilbud/fjos"')
    expect(html).toContain('href="/tilbud/riving"')
    expect(html).toContain("Utkast")
    expect(html).toContain("Sendt")
    expect(html).toContain("Ingen beskrivelse")
    expect(html).not.toContain("Ingen KI-beskrivelse")
  })

  it("lager ingen lenker med lesetilgang", () => {
    const html = renderPaServer(true)
    expect(html).not.toContain('href="/tilbud/')
    expect(html).toContain("Riving av låve")
  })
})
