import { describe, expect, it } from "vitest"

import {
  beregnEtterkalkyle,
  beregnKalkyle,
  beregnLinje,
  byggKundevisning,
  instansierMal,
  klemParameter,
} from "../../lib/kalkyle/beregn"
import { formatKr, formatKrMedFortegn, formatProsent } from "../../lib/kalkyle/format"
import {
  MOCK_FAKTISK,
  MOCK_INNKJOP,
  MOCK_KALKYLE,
  MOCK_MALER,
  MOCK_PRISING,
  MOCK_SIGNERT_SNAPSHOT,
} from "../../lib/kalkyle/mock"
import type { Detaljniva, Kalkyle } from "../../lib/kalkyle/types"

const bad = MOCK_MALER.find((m) => m.id === "bad-komplett")!

describe("beregnKalkyle – fasit for badet i Fjellveien 12", () => {
  const r = beregnKalkyle(MOCK_KALKYLE)

  it("salg 90 750 kr eks. mva (råverdi 90 749,65)", () => {
    expect(r.totalt.salgEksMva).toBeCloseTo(90749.65, 2)
    expect(formatKr(r.totalt.salgEksMva)).toBe(formatKr(90750))
  })

  it("kost 71 291 kr", () => {
    expect(r.totalt.kost).toBeCloseTo(71291, 6)
  })

  it("dekningsgrad 21,4 %", () => {
    expect(r.totalt.dekningsgrad).toBeCloseTo(0.2144, 4)
    expect(formatProsent(r.totalt.dekningsgrad)).toBe("21,4 %")
  })

  it("50 timer", () => {
    expect(r.totalt.timer).toBe(50)
  })

  it("mva 25 % og totalt inkl. mva", () => {
    expect(r.totalt.mva).toBeCloseTo(22687.41, 2)
    expect(r.totalt.inklMva).toBeCloseTo(113437.06, 2)
    expect(r.totalt.fortjeneste).toBeCloseTo(19458.65, 2)
  })

  it("delsummer per post", () => {
    expect(r.poster.map((p) => Math.round(p.salgEksMva * 100) / 100)).toEqual([16620, 38941.15, 20350, 14838.5])
    expect(r.poster.map((p) => p.timer)).toEqual([16, 28, 0, 6])
  })

  it("summen av postene er totalen", () => {
    const sum = r.poster.reduce((s, p) => s + p.salgEksMva, 0)
    expect(sum).toBeCloseTo(r.totalt.salgEksMva, 6)
  })
})

describe("beregnLinje", () => {
  it("arbeid: salg = antall × timesats, kost = antall × intern kost", () => {
    const l = beregnLinje({ id: "a", beskrivelse: "Riving", type: "arbeid", antall: 12, enhet: "t", innpris: null }, MOCK_PRISING)
    expect(l.salgEksMva).toBe(9000)
    expect(l.kost).toBe(5760)
    expect(l.timer).toBe(12)
    expect(l.enhetsprisSalg).toBe(750)
  })

  it("materiell: salg = kost × (1 + påslag/100)", () => {
    const l = beregnLinje({ id: "m", beskrivelse: "Veggfliser", type: "materiell", antall: 22, enhet: "m²", innpris: 389 }, MOCK_PRISING)
    expect(l.kost).toBe(8558)
    expect(l.salgEksMva).toBeCloseTo(9841.7, 6)
    expect(l.enhetsprisSalg).toBeCloseTo(447.35, 6)
  })

  it("UE bruker påslaget for UE", () => {
    const l = beregnLinje({ id: "u", beskrivelse: "Rørlegger", type: "ue", antall: 1, enhet: "rs", innpris: 18500 }, MOCK_PRISING)
    expect(l.salgEksMva).toBeCloseTo(20350, 6)
  })

  it("arbeid ignorerer innpris, og rare tall blir 0", () => {
    const l = beregnLinje({ id: "x", beskrivelse: "", type: "arbeid", antall: 2, enhet: "t", innpris: 999 }, MOCK_PRISING)
    expect(l.kost).toBe(960)
    const rar = beregnLinje({ id: "y", beskrivelse: "", type: "materiell", antall: Number.NaN, enhet: "stk", innpris: -5 }, MOCK_PRISING)
    expect(rar.salgEksMva).toBe(0)
    expect(rar.kost).toBe(0)
  })
})

describe("påslag per linje", () => {
  it("en linje med eget påslag bruker det, andre følger kalkylens", () => {
    const l = beregnLinje({ id: "v", beskrivelse: "Veggfliser", type: "materiell", antall: 22, enhet: "m²", innpris: 389, paslag: 25 }, MOCK_PRISING)
    expect(l.salgEksMva).toBeCloseTo(8558 * 1.25, 6)
    expect(l.enhetsprisSalg).toBeCloseTo(389 * 1.25, 6)
  })

  it("endret påslag for hele kalkylen rører ikke linjer med eget påslag", () => {
    const linje = { id: "v", beskrivelse: "Veggfliser", type: "materiell" as const, antall: 1, enhet: "stk" as const, innpris: 100, paslag: 30 }
    expect(beregnLinje(linje, { ...MOCK_PRISING, paslagMateriell: 50 }).salgEksMva).toBeCloseTo(130, 6)
    expect(beregnLinje({ ...linje, paslag: null }, { ...MOCK_PRISING, paslagMateriell: 50 }).salgEksMva).toBeCloseTo(150, 6)
  })

  it("arbeid og fast jobb har aldri påslag, selv om feltet er satt", () => {
    const l = beregnLinje({ id: "a", beskrivelse: "Riving", type: "arbeid", antall: 2, enhet: "t", innpris: null, paslag: 40 }, MOCK_PRISING)
    expect(l.salgEksMva).toBe(1500)
  })
})

describe("kanttilfeller", () => {
  it("tom kalkyle gir dekningsgrad 0 og ingen NaN", () => {
    const tom: Kalkyle = { ...MOCK_PRISING, id: "tom", prosjektId: "p", poster: [] }
    const r = beregnKalkyle(tom)
    expect(r.totalt.salgEksMva).toBe(0)
    expect(r.totalt.dekningsgrad).toBe(0)
  })

  it("poster sorteres etter rekkefølge", () => {
    const stokket: Kalkyle = { ...MOCK_KALKYLE, poster: [...MOCK_KALKYLE.poster].reverse() }
    expect(beregnKalkyle(stokket).poster.map((p) => p.postId)).toEqual(["riving", "membran", "ror", "innredning"])
  })
})

describe("instansierMal", () => {
  it("Bad komplett ved 6 m² gir nøyaktig fasit-kalkylen", () => {
    const k = instansierMal(bad, 6, MOCK_PRISING, { kalkyleId: "k", prosjektId: "p" })
    const r = beregnKalkyle(k)
    expect(r.totalt.salgEksMva).toBeCloseTo(90749.65, 2)
    expect(r.totalt.kost).toBeCloseTo(71291, 6)
    expect(r.totalt.timer).toBe(50)
    const veggfliser = k.poster[1].linjer.find((l) => l.beskrivelse === "Veggfliser")!
    expect(veggfliser.antall).toBe(22)
  })

  it("mengden følger parameteren (fast + perEnhet × areal)", () => {
    const k = instansierMal(bad, 10, MOCK_PRISING, { kalkyleId: "k", prosjektId: "p" })
    expect(k.poster[1].linjer.find((l) => l.beskrivelse === "Veggfliser")!.antall).toBe(34)
    expect(beregnKalkyle(k).totalt.timer).toBe(4 + 16 + 40 + 6)
  })

  it("parameteren klemmes til min og maks", () => {
    expect(klemParameter(bad, 100)).toBe(20)
    expect(klemParameter(bad, 0)).toBe(2)
    expect(klemParameter(bad, Number.NaN)).toBe(6)
  })

  it("arbeid får innpris null", () => {
    const k = instansierMal(bad, 6, MOCK_PRISING, { kalkyleId: "k", prosjektId: "p" })
    for (const post of k.poster) {
      for (const linje of post.linjer) {
        if (linje.type === "arbeid") expect(linje.innpris).toBeNull()
      }
    }
  })
})

describe("byggKundevisning – kunden ser aldri innpris, påslag eller fortjeneste", () => {
  const nivaer: Detaljniva[] = ["total", "post", "linje"]

  it.each(nivaer)("nivå %s: ingen interne tall i det som sendes til kunden", (niva) => {
    const visning = byggKundevisning(MOCK_KALKYLE, niva, true)
    const json = JSON.stringify(visning).toLowerCase()
    for (const forbudt of ["innpris", "kost", "paslag", "fortjeneste", "dekningsgrad", "internkost", "anslag"]) {
      expect(json).not.toContain(forbudt)
    }
    // Ingen innpris skal lekke som tall heller.
    expect(json).not.toContain("389,")
    expect(json).not.toMatch(/[^.\d]389[^.\d]/)
  })

  it.each(nivaer)("nivå %s: summen er 90 750 kr eks. mva", (niva) => {
    const visning = byggKundevisning(MOCK_KALKYLE, niva, false)
    const radsum = visning.rader.reduce((s, r) => s + (r.type === "rad" ? r.sum : 0), 0)
    expect(radsum).toBeCloseTo(90749.65, 2)
    expect(visning.sumEksMva).toBeCloseTo(90749.65, 2)
    expect(visning.sumInklMva).toBeCloseTo(113437.06, 2)
  })

  it("per post: fire rader, timer bare når visTimer er på", () => {
    const med = byggKundevisning(MOCK_KALKYLE, "post", true)
    expect(med.rader).toHaveLength(4)
    expect(med.rader.map((r) => r.timer)).toEqual([16, 28, null, 6])
    const uten = byggKundevisning(MOCK_KALKYLE, "post", false)
    expect(uten.rader.every((r) => r.timer === null)).toBe(true)
  })

  it("alle linjer: en gruppe per post og salgspris per enhet", () => {
    const v = byggKundevisning(MOCK_KALKYLE, "linje", false)
    expect(v.rader.filter((r) => r.type === "gruppe")).toHaveLength(4)
    const flis = v.rader.find((r) => r.type === "rad" && r.tekst === "Veggfliser")
    expect(flis?.type === "rad" && flis.enhetspris).toBeCloseTo(447.35, 6)
  })

  it("kun totalsum: én rad", () => {
    const v = byggKundevisning(MOCK_KALKYLE, "total", true, "Totalrenovering av bad")
    expect(v.rader).toHaveLength(1)
    expect(v.rader[0].tekst).toBe("Totalrenovering av bad")
  })
})

describe("beregnEtterkalkyle – faktisk mot signert tilbud", () => {
  const e = beregnEtterkalkyle(MOCK_SIGNERT_SNAPSHOT, MOCK_FAKTISK)

  it("faktisk kostnad 76 360 kr, +5 069 kr over kalkyle", () => {
    expect(e.totalt.faktiskKost).toBe(76360)
    expect(e.totalt.avvik).toBeCloseTo(5069, 6)
    expect(formatKrMedFortegn(e.totalt.avvik)).toBe(`+${(5069).toLocaleString("nb-NO")} kr`)
  })

  it("59 timer mot 50 kalkulert", () => {
    expect(e.totalt.faktiskTimer).toBe(59)
    expect(e.totalt.kalkulertTimer).toBe(50)
  })

  it("dekningsgrad 15,9 % mot 21,4 %", () => {
    expect(formatProsent(e.totalt.dekningsgradFaktisk)).toBe("15,9 %")
    expect(formatProsent(e.totalt.dekningsgradKalkulert)).toBe("21,4 %")
  })

  it("avvik per post: −480 / +5 069 / 0 / +480", () => {
    expect(e.poster.map((p) => Math.round(p.avvik))).toEqual([-480, 5069, 0, 480])
  })

  it("materiell faktisk 25 340 kr, og innkjøpslista summerer til materiell + UE", () => {
    const materiell = MOCK_FAKTISK.poster.reduce((s, p) => s + p.materiell, 0)
    expect(materiell).toBe(25340)
    const innkjop = MOCK_INNKJOP.reduce((s, i) => s + i.belop, 0)
    expect(innkjop).toBe(25340 + 22700)
  })

  it("kjøring legges til faktisk kostnad", () => {
    const medKjoring = beregnEtterkalkyle(MOCK_SIGNERT_SNAPSHOT, { ...MOCK_FAKTISK, kjoring: 1200 })
    expect(medKjoring.totalt.faktiskKost).toBe(77560)
    expect(medKjoring.totalt.kjoring).toBe(1200)
  })

  it("post uten føringer regnes som 0 faktisk", () => {
    const tom = beregnEtterkalkyle(MOCK_SIGNERT_SNAPSHOT, { poster: [] })
    expect(tom.totalt.faktiskKost).toBe(0)
    expect(tom.totalt.faktiskTimer).toBe(0)
  })
})
