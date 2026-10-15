import { describe, expect, it } from "vitest"

import { beregnKalkyle } from "../../lib/kalkyle/beregn"
import { angreEndring, brukEndringer, type KalkyleEndring } from "../../lib/kalkyle/endringer"
import { MOCK_KALKYLE } from "../../lib/kalkyle/mock"

const inkl = (k: typeof MOCK_KALKYLE) => beregnKalkyle(k).totalt.inklMva

describe("brukEndringer", () => {
  it("varmekabler: tre nye linjer, kunden betaler 113 437 → 125 079 kr", () => {
    const endringer: KalkyleEndring[] = [
      { type: "leggTil", postId: "membran", linje: { beskrivelse: "Varmekabelmatte 6 m²", type: "materiell", antall: 1, enhet: "sett", innpris: 2490 } },
      { type: "leggTil", postId: "membran", linje: { beskrivelse: "Legging av varmekabel", type: "arbeid", antall: 2, enhet: "t", innpris: null } },
      { type: "leggTil", postId: "ror", linje: { beskrivelse: "Elektriker, tilkobling og termostat", type: "ue", antall: 1, enhet: "rs", innpris: 4500 } },
    ]
    const r = brukEndringer(MOCK_KALKYLE, endringer)
    expect(r.avvist).toEqual([])
    expect(r.berort).toHaveLength(3)
    expect(Math.round(inkl(MOCK_KALKYLE))).toBe(113437)
    expect(Math.round(inkl(r.kalkyle))).toBe(125079)
  })

  it("rører ikke originalen, så «Angre» er å beholde den", () => {
    const for_ = JSON.stringify(MOCK_KALKYLE)
    brukEndringer(MOCK_KALKYLE, [
      { type: "fjern", postId: "membran", linjeId: "membran-gulvfliser" },
      { type: "endre", postId: "membran", linjeId: "membran-veggfliser", patch: { innpris: 529 } },
      { type: "prising", felt: "timesats", verdi: 800 },
      { type: "nyPost", navn: "Elektro" },
    ])
    expect(JSON.stringify(MOCK_KALKYLE)).toBe(for_)
  })

  it("endre, fjern og prising", () => {
    const r = brukEndringer(MOCK_KALKYLE, [
      { type: "endre", postId: "membran", linjeId: "membran-veggfliser", patch: { beskrivelse: "Veggflis 60×60", innpris: 529 } },
      { type: "fjern", postId: "membran", linjeId: "membran-gulvfliser" },
      { type: "prising", felt: "paslagMateriell", verdi: 20 },
    ])
    const membran = r.kalkyle.poster.find((p) => p.id === "membran")!
    expect(membran.linjer.map((l) => l.beskrivelse)).toEqual(["Smøremembran", "Veggflis 60×60", "Membran og flislegging"])
    expect(r.kalkyle.paslagMateriell).toBe(20)
    expect(r.berort).toEqual(["membran-veggfliser"])
  })

  it("ny post havner sist og får unik id", () => {
    const r = brukEndringer(MOCK_KALKYLE, [{ type: "nyPost", navn: "Elektro" }, { type: "nyPost", navn: "Maling" }])
    const nye = r.kalkyle.poster.slice(-2)
    expect(nye.map((p) => p.navn)).toEqual(["Elektro", "Maling"])
    expect(nye[0].rekkefolge).toBe(5)
    expect(nye[0].id).not.toBe(nye[1].id)
  })

  it("ugyldige endringer avvises uten å stoppe resten", () => {
    const r = brukEndringer(MOCK_KALKYLE, [
      { type: "leggTil", postId: "finnes-ikke", linje: { beskrivelse: "X", type: "arbeid", antall: 1, enhet: "t", innpris: null } },
      { type: "endre", postId: "membran", linjeId: "finnes-ikke", patch: { antall: 3 } },
      { type: "endre", postId: "membran", linjeId: "membran-veggfliser", patch: { antall: -4 } },
      { type: "prising", felt: "timesats", verdi: Number.NaN },
      { type: "leggTil", postId: "riving", linje: { beskrivelse: "Ekstra riving", type: "arbeid", antall: 4, enhet: "t", innpris: null } },
    ])
    expect(r.avvist).toHaveLength(4)
    expect(Math.round(inkl(r.kalkyle))).toBe(Math.round(inkl(MOCK_KALKYLE) + 4 * 750 * 1.25))
  })

  it("arbeid får alltid innpris null, også når type endres til arbeid", () => {
    const r = brukEndringer(MOCK_KALKYLE, [
      { type: "endre", postId: "innredning", linjeId: "innredning-innredning", patch: { type: "arbeid", enhet: "t" } },
    ])
    const linje = r.kalkyle.poster.find((p) => p.id === "innredning")!.linjer[0]
    expect(linje.innpris).toBeNull()
  })
})

describe("angreEndring: reverserer bare den ene endringen", () => {
  const bruk = (k: typeof MOCK_KALKYLE, e: KalkyleEndring[]) => brukEndringer(k, e).kalkyle
  const linje = (k: typeof MOCK_KALKYLE, id: string) => k.poster.flatMap((p) => p.linjer).find((l) => l.id === id)

  it("slettet linje kommer tilbake på plassen sin, og senere endringer blir stående", () => {
    const foer = MOCK_KALKYLE
    const etter = bruk(foer, [{ type: "fjern", postId: "membran", linjeId: "membran-veggfliser" }])
    // Etter slettingen endrer brukeren timeprisen og antall gulvfliser.
    const naa = bruk(etter, [
      { type: "prising", felt: "timesats", verdi: 800 },
      { type: "endre", postId: "membran", linjeId: "membran-gulvfliser", patch: { antall: 9 } },
    ])
    const angret = angreEndring(foer, etter, naa)
    expect(angret.poster.find((p) => p.id === "membran")!.linjer.map((l) => l.id)).toEqual(
      foer.poster.find((p) => p.id === "membran")!.linjer.map((l) => l.id)
    )
    expect(angret.timesats).toBe(800)
    expect(linje(angret, "membran-gulvfliser")!.antall).toBe(9)
  })

  it("en endring av ett felt angres uten å røre andre felt som er endret siden", () => {
    const foer = MOCK_KALKYLE
    const etter = bruk(foer, [{ type: "endre", postId: "membran", linjeId: "membran-veggfliser", patch: { innpris: 450 } }])
    const naa = bruk(etter, [{ type: "endre", postId: "membran", linjeId: "membran-veggfliser", patch: { antall: 30 } }])
    const angret = angreEndring(foer, etter, naa)
    expect(linje(angret, "membran-veggfliser")).toMatchObject({ innpris: 389, antall: 30 })
  })

  it("nye linjer og en ny, tom post fjernes; en post brukeren har fylt siden, blir stående", () => {
    const foer = MOCK_KALKYLE
    const etter = bruk(foer, [
      { type: "nyPost", id: "ny-ventilasjon", navn: "Ventilasjon" },
      { type: "leggTil", postId: "ny-ventilasjon", linje: { beskrivelse: "Vifte", type: "materiell", antall: 1, enhet: "stk", innpris: 900 } },
      { type: "prising", felt: "paslagMateriell", verdi: 20 },
    ])
    const tom = angreEndring(foer, etter, etter)
    expect(tom.poster.map((p) => p.id)).toEqual(foer.poster.map((p) => p.id))
    expect(tom.paslagMateriell).toBe(foer.paslagMateriell)
    expect(inkl(tom)).toBeCloseTo(inkl(foer), 6)

    const fylt = bruk(etter, [
      { type: "leggTil", postId: "ny-ventilasjon", linje: { beskrivelse: "Kanal", type: "materiell", antall: 2, enhet: "lm", innpris: 120 } },
    ])
    const angret = angreEndring(foer, etter, fylt)
    expect(angret.poster.find((p) => p.id === "ny-ventilasjon")!.linjer.map((l) => l.beskrivelse)).toEqual(["Kanal"])
  })

  it("en slettet post kommer tilbake med linjene sine", () => {
    const foer = MOCK_KALKYLE
    const etter = { ...foer, poster: foer.poster.filter((p) => p.id !== "ror") }
    const angret = angreEndring(foer, etter, etter)
    expect(angret.poster.find((p) => p.id === "ror")!.linjer.map((l) => l.id)).toEqual(["ror-rorlegger"])
  })
})

