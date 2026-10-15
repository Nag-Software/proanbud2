import { describe, expect, it } from "vitest"

import { beregnKalkyle, instansierMal } from "../../lib/kalkyle/beregn"
import { tolkMock } from "../../lib/kalkyle/chat-mock"
import { beskrivEndringer, brukEndringer } from "../../lib/kalkyle/endringer"
import { MOCK_KALKYLE, MOCK_MALER, MOCK_PRISING } from "../../lib/kalkyle/mock"

const inklEtter = (tekst: string) => {
  const svar = tolkMock(tekst, MOCK_KALKYLE)
  return Math.round(beregnKalkyle(brukEndringer(MOCK_KALKYLE, svar.endringer).kalkyle).totalt.inklMva)
}

describe("tolkMock – «Skriv hva du vil endre» i mock-runden", () => {
  it("varmekabler gir tre linjer og 125 079 kr inkl. mva", () => {
    const svar = tolkMock("Kunden vil ha varmekabler i gulvet", MOCK_KALKYLE)
    expect(svar.endringer).toHaveLength(3)
    expect(inklEtter("Kunden vil ha varmekabler i gulvet")).toBe(125079)
  })

  it("«4 timer ekstra riving» havner under Riving og rigg", () => {
    const svar = tolkMock("4 timer ekstra riving", MOCK_KALKYLE)
    expect(svar.endringer).toEqual([
      { type: "leggTil", postId: "riving", linje: { beskrivelse: "Ekstra riving", type: "arbeid", antall: 4, enhet: "t", innpris: null } },
    ])
    expect(inklEtter("4 timer ekstra riving")).toBe(117187)
  })

  it("60×60-fliser endrer veggflisene", () => {
    const svar = tolkMock("Bytt til 60×60-fliser på veggen", MOCK_KALKYLE)
    expect(svar.endringer[0]).toMatchObject({ type: "endre", linjeId: "membran-veggfliser" })
  })

  it("påslag og timepris", () => {
    expect(tolkMock("Sett påslaget på materiell til 20 %", MOCK_KALKYLE).endringer).toEqual([
      { type: "prising", felt: "paslagMateriell", verdi: 20 },
    ])
    expect(tolkMock("påslag på underentreprenør 12 %", MOCK_KALKYLE).endringer[0]).toMatchObject({ felt: "paslagUe", verdi: 12 })
    expect(tolkMock("timepris 800", MOCK_KALKYLE).endringer[0]).toMatchObject({ felt: "timesats", verdi: 800 })
  })

  it("fjerne en linje", () => {
    expect(tolkMock("fjern gulvfliser", MOCK_KALKYLE).endringer).toEqual([
      { type: "fjern", postId: "membran", linjeId: "membran-gulvfliser" },
    ])
  })

  it("ukjent tekst gir ingen endringer, men eksempler", () => {
    const svar = tolkMock("hei", MOCK_KALKYLE)
    expect(svar.endringer).toEqual([])
    expect(svar.eksempler.length).toBeGreaterThan(0)
  })

  it("virker også på en kalkyle laget fra en annen mal", () => {
    const kjokken = instansierMal(MOCK_MALER.find((m) => m.id === "kjokkenmontering")!, 4, MOCK_PRISING, { kalkyleId: "k", prosjektId: "p" })
    const svar = tolkMock("2 timer ekstra riving", kjokken)
    expect(brukEndringer(kjokken, svar.endringer).avvist).toEqual([])
  })

  it("kalkyle uten poster gir en forklaring, ikke en feil", () => {
    const svar = tolkMock("4 timer riving", { ...MOCK_KALKYLE, poster: [] })
    expect(svar.endringer).toEqual([])
  })
})

describe("beskrivEndringer – kortet brukeren ser før «Legg inn»", () => {
  it("viser fortegn, sted og beløp", () => {
    const svar = tolkMock("Kunden vil ha varmekabler i gulvet", MOCK_KALKYLE)
    const b = beskrivEndringer(MOCK_KALKYLE, svar.endringer)
    expect(b.map((x) => x.tegn)).toEqual(["+", "+", "+"])
    expect(b.map((x) => x.sted)).toEqual(["Membran og fliser", "Membran og fliser", "Rør"])
    expect(b.map((x) => Math.round(x.belop ?? 0))).toEqual([2864, 1500, 4950])
  })

  it("endring og fjerning viser differansen", () => {
    const b = beskrivEndringer(MOCK_KALKYLE, [
      { type: "endre", postId: "membran", linjeId: "membran-veggfliser", patch: { beskrivelse: "Veggflis 60×60", innpris: 529 } },
      { type: "fjern", postId: "membran", linjeId: "membran-gulvfliser" },
      { type: "prising", felt: "timesats", verdi: 800 },
    ])
    expect(b[0]).toMatchObject({ tegn: "~", tekst: "Veggfliser → Veggflis 60×60" })
    expect(Math.round(b[0].belop!)).toBe(3542)
    expect(b[1]).toMatchObject({ tegn: "−", tekst: "Gulvfliser" })
    expect(b[2]).toMatchObject({ tegn: "~", sted: "Prising", belop: null })
  })
})
