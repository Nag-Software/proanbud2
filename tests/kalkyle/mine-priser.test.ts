import { describe, expect, it } from "vitest"

import { beregnEtterkalkyle, beregnKalkyle, beregnLinje, byggKundevisning } from "../../lib/kalkyle/beregn"
import { brukEndringer } from "../../lib/kalkyle/endringer"
import {
  enhetFraPrisfil,
  linjeFraPrisliste,
  fraLagredeJobber,
  fraTimepriser,
  linjeFraLagretJobb,
  snittKost,
  standardPrising,
} from "../../lib/kalkyle/mine-priser"
import { MOCK_KALKYLE, MOCK_PRISING, MOCK_SIGNERT_SNAPSHOT } from "../../lib/kalkyle/mock"
import type { Linje, TimeprisValg } from "../../lib/kalkyle/types"
import { mapHourlyRateRows } from "../../lib/tilbud/labor"

const tomrer: TimeprisValg = { id: "tp-1", navn: "Tømrer", timesats: 795, internKost: 510 }
const laerling: TimeprisValg = { id: "tp-2", navn: "Lærling", timesats: 550, internKost: null }

describe("Timepriser i kalkylen", () => {
  it("rader fra /api/mine-priser/timepriser blir timepriser, i samme rekkefølge", () => {
    const rader = mapHourlyRateRows([
      { id: "a", job_type: "Tømrer", hourly_rate_nok: "795", cost_rate_nok: "510" },
      { id: "b", job_type: "Lærling", hourly_rate_nok: 550, cost_rate_nok: null },
      { id: "c", job_type: "Ugyldig", hourly_rate_nok: 0 },
    ])
    expect(fraTimepriser(rader)).toEqual([
      { id: "a", navn: "Tømrer", timesats: 795, internKost: 510 },
      { id: "b", navn: "Lærling", timesats: 550, internKost: null },
    ])
  })

  it("standardprisingen tar første timepris; intern kost faller tilbake til snittet", () => {
    expect(standardPrising([tomrer, laerling], MOCK_PRISING)).toMatchObject({ timesats: 795, internKostPerTime: 510 })
    expect(standardPrising([laerling, tomrer], MOCK_PRISING)).toMatchObject({ timesats: 550, internKostPerTime: 510 })
    expect(standardPrising([], MOCK_PRISING)).toEqual(MOCK_PRISING)
    expect(snittKost([laerling])).toBeNull()
  })

  it("en timelinje med egen timepris bruker dens salgs- og kostpris", () => {
    const linje: Linje = { id: "x", beskrivelse: "Flislegging", type: "arbeid", antall: 10, enhet: "t", innpris: null, timepris: tomrer }
    const r = beregnLinje(linje, MOCK_PRISING)
    expect(r.salgEksMva).toBe(7950)
    expect(r.kost).toBe(5100)
  })

  it("timepris uten kostpris bruker kalkylens intern kost", () => {
    const linje: Linje = { id: "x", beskrivelse: "Rydding", type: "arbeid", antall: 4, enhet: "t", innpris: null, timepris: laerling }
    const r = beregnLinje(linje, MOCK_PRISING)
    expect(r.salgEksMva).toBe(2200)
    expect(r.kost).toBe(4 * MOCK_PRISING.internKostPerTime)
  })

  it("å bytte bort fra arbeid fjerner timeprisen", () => {
    const k = brukEndringer(MOCK_KALKYLE, [
      { type: "endre", postId: "riving", linjeId: "riving-riving", patch: { timepris: tomrer } },
      { type: "endre", postId: "riving", linjeId: "riving-riving", patch: { type: "materiell", innpris: 100 } },
    ]).kalkyle
    expect(k.poster[0].linjer[1].timepris).toBeNull()
  })
})

describe("Lagrede jobber som «Fast jobb»", () => {
  const jobb = { id: "j-1", navn: "Montering av toalett", pris: 3500, timer: 3 }

  it("rader fra /api/mine-priser/lagrede-jobber blir jobber", () => {
    expect(
      fraLagredeJobber([
        { id: "j-1", name: "Montering av toalett", price_nok: 3500, estimated_hours: 3 },
        { id: "j-2", name: "Uten timer", price_nok: 1200 },
        { id: "", name: "Mangler id", price_nok: 1 },
      ])
    ).toEqual([jobb, { id: "j-2", navn: "Uten timer", pris: 1200, timer: null }])
  })

  it("kunden betaler fastprisen; kost anslås som timer × intern kost", () => {
    const linje: Linje = { ...linjeFraLagretJobb(jobb), id: "l", antall: 2 }
    const r = beregnLinje(linje, MOCK_PRISING)
    expect(r.salgEksMva).toBe(7000)
    expect(r.timer).toBe(6)
    expect(r.kost).toBe(6 * MOCK_PRISING.internKostPerTime)
    expect(r.enhetsprisSalg).toBe(3500)
  })

  it("en fast jobb lagt i kalkylen gir 3 500 kr eks. mva mer og 3 t mer", () => {
    const for_ = beregnKalkyle(MOCK_KALKYLE).totalt
    const etter = beregnKalkyle(
      brukEndringer(MOCK_KALKYLE, [{ type: "leggTil", postId: "innredning", linje: linjeFraLagretJobb(jobb) }]).kalkyle
    ).totalt
    expect(etter.salgEksMva - for_.salgEksMva).toBeCloseTo(3500, 6)
    expect(etter.timer - for_.timer).toBe(3)
  })

  it("kundevisningen viser fastprisen, ikke timer eller kost", () => {
    const k = brukEndringer(MOCK_KALKYLE, [{ type: "leggTil", postId: "innredning", linje: linjeFraLagretJobb(jobb) }]).kalkyle
    const v = byggKundevisning(k, "linje", false)
    const rad = v.rader.find((r) => r.type === "rad" && r.tekst === "Montering av toalett")
    expect(rad).toMatchObject({ enhetspris: 3500, sum: 3500, timer: null })
    expect(JSON.stringify(v)).not.toContain("timerPerEnhet")
  })

  it("etterkalkylen regner ikke en fast jobb som materiell", () => {
    const k = brukEndringer(MOCK_KALKYLE, [{ type: "leggTil", postId: "innredning", linje: linjeFraLagretJobb(jobb) }]).kalkyle
    const e = beregnEtterkalkyle({ ...MOCK_SIGNERT_SNAPSHOT, kalkyle: k }, { poster: [] })
    expect(e.poster.find((p) => p.postId === "innredning")?.kalkulertMateriell).toBe(8990)
  })
})

describe("Materiell fra prislisten", () => {
  it("enheter fra prisfilene blir kalkyle-enheter", () => {
    expect(["STK", "M2", "m²", "M", "RUL", "PAL", "Sett", "ukjent", null].map(enhetFraPrisfil)).toEqual([
      "stk", "m²", "m²", "lm", "rull", "pall", "sett", "stk", "stk",
    ])
  })

  it("en vare blir en materiell-linje med innprisen fra prislisten", () => {
    expect(linjeFraPrisliste({ product: " Flislim 15 kg ", unit: "STK", unitPriceNok: 329 })).toEqual({
      beskrivelse: "Flislim 15 kg",
      type: "materiell",
      antall: 1,
      enhet: "stk",
      innpris: 329,
      anslag: false,
    })
  })
})
