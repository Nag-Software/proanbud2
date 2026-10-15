import { describe, expect, it } from "vitest"

import { byggKundevisning } from "../../lib/kalkyle/beregn"
import { MOCK_KALKYLE } from "../../lib/kalkyle/mock"
import { kundevisningTilLinjer } from "../../lib/kalkyle/tilbud-dokument"
import { calculateOfferTotals } from "../../lib/tilbud/types"

const linjer = (niva: "total" | "post" | "linje", visTimer = false) =>
  kundevisningTilLinjer(byggKundevisning(MOCK_KALKYLE, niva, visTimer, "Bad 6 m² – Fjellveien 12"))

describe("tilbudsdokumentet fra kalkylen", () => {
  it.each(["total", "post", "linje"] as const)("nivå %s: dokumentet summerer til 90 750 kr eks. mva", (niva) => {
    expect(calculateOfferTotals(linjer(niva)).totalNok).toBeCloseTo(90749.65, 1)
  })

  it("kun totalsum: én linje uten gruppeoverskrift", () => {
    const l = linjer("total")
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ subproject: "Generelt", title: "Bad 6 m² – Fjellveien 12", quantity: 1, unit: "RS" })
  })

  it("per post: én linje per post, med timer i beskrivelsen når det er valgt", () => {
    const l = linjer("post", true)
    expect(l.map((x) => x.title)).toEqual(["Riving og rigg", "Membran og fliser", "Rør", "Innredning"])
    expect(l[1].description).toBe("Inkl. 28 timer arbeid")
    expect(l[2].description).toBe("")
  })

  it("alle linjer: gruppert per post, med dokumentets enheter og salgspris", () => {
    const l = linjer("linje")
    const flis = l.find((x) => x.title === "Veggfliser")!
    expect(flis).toMatchObject({ subproject: "Membran og fliser", quantity: 22, unit: "m2" })
    expect(flis.unitPriceNok).toBeCloseTo(447.35, 6)
    expect(l.find((x) => x.title === "Riving")).toMatchObject({ unit: "time", unitPriceNok: 750 })
  })

  it("rull og pall blir med som enheter i dokumentet", () => {
    const k = { ...MOCK_KALKYLE, poster: [{ id: "p", navn: "Underlag", rekkefolge: 1, linjer: [
      { id: "a", beskrivelse: "Trinnlydplate", type: "materiell" as const, antall: 3, enhet: "rull" as const, innpris: 400 },
      { id: "b", beskrivelse: "Gulvsponplater", type: "materiell" as const, antall: 1, enhet: "pall" as const, innpris: 9000 },
    ] }] }
    const l = kundevisningTilLinjer(byggKundevisning(k, "linje", false))
    expect(l.map((x) => x.unit)).toEqual(["rull", "pall"])
  })

  it("ingen påslag, rabatt eller leverandør følger med til kunden", () => {
    for (const x of linjer("linje")) {
      expect(x.markupPercent).toBe(0)
      expect(x.discountPercent).toBe(0)
      expect(x.supplier).toBe("")
      expect(x.costRateNok).toBeUndefined()
    }
  })
})
