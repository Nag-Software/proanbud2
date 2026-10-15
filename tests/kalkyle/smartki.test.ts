import { describe, expect, it } from "vitest"

import { beregnKalkyle } from "../../lib/kalkyle/beregn"
import { brukEndringer } from "../../lib/kalkyle/endringer"
import { MOCK_KALKYLE } from "../../lib/kalkyle/mock"
import {
  SMARTKI_GRENSER,
  byggSmartkiMelding,
  fjernIder,
  parseSmartkiSvar,
  prisfilSokeord,
  smartkiForesporselSkjema,
  tilKalkyleEndringer,
  type SmartkiKontekst,
} from "../../lib/kalkyle/smartki"
import type { Kalkyle } from "../../lib/kalkyle/types"
import { proposeWithRepair, type LlmMessage } from "../../lib/llm/propose-with-repair"

const kontekst: SmartkiKontekst = {
  timepriser: [{ id: "tp-flis", navn: "Flislegger", timesats: 820, internKost: 520 }],
  lagredeJobber: [{ id: "j-toalett", navn: "Montering av toalett", pris: 3500, timer: 3 }],
  prisfilTreff: [{ id: "pr-1", produkt: "Varmekabelmatte 6 m²", enhet: "stk", innpris: 2490, leverandor: "Elektrogrossist AS" }],
}

const foresporsel = (overstyr: Record<string, unknown> = {}) =>
  smartkiForesporselSkjema.parse({
    generationId: "11111111-1111-4111-8111-111111111111",
    sporsmal: "Er prisen markedsdyktig?",
    kalkyle: MOCK_KALKYLE,
    ...overstyr,
  })

describe("SmartKI – meldingen til modellen", () => {
  it("har kalkylen med id-er og ferdige nøkkeltall", () => {
    const data = JSON.parse(byggSmartkiMelding({ foresporsel: foresporsel(), kontekst }))
    expect(data.merknad).toBeUndefined()
    expect(data.nokkeltall).toMatchObject({ salgEksMva: 90750, kostnad: 71291, dekningsgradProsent: 21.4, timer: 50 })
    expect(data.poster[1]).toMatchObject({ postId: "membran", navn: "Membran og fliser" })
    expect(data.poster[1].linjer[1]).toMatchObject({ linjeId: "membran-veggfliser", innpris: 389 })
    expect(data.timepriser[0]).toMatchObject({ timeprisId: "tp-flis", timesats: 820 })
    expect(data.lagredeJobber[0]).toMatchObject({ lagretJobbId: "j-toalett", fastpris: 3500 })
    expect(data.prisfilTreff[0]).toMatchObject({ innpris: 2490 })
    expect(data.sporsmal).toBe("Er prisen markedsdyktig?")
  })

  it("er budsjettert: største tillatte kalkyle og samtale gir en begrenset melding", () => {
    const lang = "x".repeat(SMARTKI_GRENSER.tekst)
    const stor: Kalkyle = {
      ...MOCK_KALKYLE,
      poster: Array.from({ length: SMARTKI_GRENSER.poster }, (_, p) => ({
        id: `p${p}`,
        navn: lang,
        rekkefolge: p,
        linjer: Array.from({ length: SMARTKI_GRENSER.linjerPerPost }, (_, l) => ({
          id: `p${p}-l${l}`,
          beskrivelse: lang,
          type: "materiell" as const,
          antall: 1,
          enhet: "stk" as const,
          innpris: 100,
        })),
      })),
    }
    const f = foresporsel({
      kalkyle: stor,
      sporsmal: "y".repeat(SMARTKI_GRENSER.sporsmal),
      samtale: Array.from({ length: SMARTKI_GRENSER.meldinger }, () => ({ rolle: "bruker", tekst: "z".repeat(SMARTKI_GRENSER.meldingTegn) })),
    })
    const melding = byggSmartkiMelding({ foresporsel: f, kontekst })
    // Største tillatte kalkyle havner under taket, med linjene forkortet.
    expect(melding.length).toBeLessThanOrEqual(SMARTKI_GRENSER.meldingTegn_totalt)
    expect(JSON.parse(melding).merknad).toContain("forkortet")
  })

  it("avviser kalkyler og samtaler over grensene", () => {
    const forMange = { ...MOCK_KALKYLE, poster: Array.from({ length: SMARTKI_GRENSER.poster + 1 }, (_, i) => ({ id: `p${i}`, navn: "P", rekkefolge: i, linjer: [] })) }
    expect(smartkiForesporselSkjema.safeParse({ generationId: crypto.randomUUID(), sporsmal: "hei der", kalkyle: forMange }).success).toBe(false)
    expect(
      smartkiForesporselSkjema.safeParse({ generationId: crypto.randomUUID(), sporsmal: "x".repeat(SMARTKI_GRENSER.sporsmal + 1), kalkyle: MOCK_KALKYLE }).success
    ).toBe(false)
  })

  it("prisfil-søket bruker bare trygge søkeord", () => {
    expect(prisfilSokeord("Kunden vil ha varmekabler i gulvet, 6 m²!")).toEqual(["varmekabler", "gulvet"])
    expect(prisfilSokeord("bytt til 60x60 fliser %,(or)")).toEqual(["60x60", "fliser"])
  })
})

describe("SmartKI – svaret fra modellen", () => {
  it("godtar svar med spørsmål uten endringer", () => {
    const r = parseSmartkiSvar(JSON.stringify({ svar: "Prisen ligger midt i spennet.", oppfolging: ["Hvor tjener jeg minst?"] }))
    expect(r).toEqual({ ok: true, value: { svar: "Prisen ligger midt i spennet.", endringer: [], oppfolging: ["Hvor tjener jeg minst?"], forkastet: 0 } })
  })

  it("er tolerant: aliaser for enhet og type, tall som tekst, og ugyldige enkeltendringer droppes", () => {
    const r = parseSmartkiSvar(
      JSON.stringify({
        svar: "Lagt inn.",
        endringer: [
          { type: "leggTil", postId: "riving", linje: { beskrivelse: "Ekstra riving", type: "timer", antall: "4", enhet: "timer" } },
          { type: "ukjent" },
          { type: "prising", felt: "paslagMateriell", verdi: "20" },
        ],
      })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.endringer).toHaveLength(2)
    expect(r.value.endringer[0]).toMatchObject({ linje: { type: "arbeid", antall: 4, enhet: "t" } })
    expect(r.value.forkastet).toBe(1)
  })

  it("påslag per linje og enhetene rull og pall kommer gjennom", () => {
    const r = parseSmartkiSvar(
      JSON.stringify({
        svar: "Ok.",
        endringer: [
          { type: "endre", postId: "membran", linjeId: "membran-veggfliser", patch: { paslag: 25 } },
          { type: "leggTil", postId: "membran", linje: { beskrivelse: "Trinnlyd", type: "materiell", antall: 2, enhet: "ruller", innpris: 400 } },
        ],
      })
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { endringer } = tilKalkyleEndringer(r.value.endringer, MOCK_KALKYLE, kontekst)
    const k = brukEndringer(MOCK_KALKYLE, endringer).kalkyle
    expect(k.poster[1].linjer[1].paslag).toBe(25)
    expect(k.poster[1].linjer.at(-1)?.enhet).toBe("rull")
  })

  it("feiler på ugyldig JSON og manglende svar", () => {
    expect(parseSmartkiSvar("ikke json").ok).toBe(false)
    expect(parseSmartkiSvar(JSON.stringify({ endringer: [] })).ok).toBe(false)
  })
})

describe("SmartKI – fra modellens endringer til kalkylen", () => {
  it("timeprisId og lagret jobb hentes fra bedriftens data; prisen fra Lagrede jobber vinner", () => {
    const { endringer, avvist } = tilKalkyleEndringer(
      [
        { type: "leggTil", postId: "membran", linje: { beskrivelse: "Flislegging", type: "arbeid", antall: 2, timeprisId: "tp-flis" } },
        { type: "leggTil", postId: "innredning", linje: { beskrivelse: "Toalett", type: "jobb", fastpris: 9999, lagretJobbId: "j-toalett" } },
      ],
      MOCK_KALKYLE,
      kontekst
    )
    expect(avvist).toBe(0)
    const k = brukEndringer(MOCK_KALKYLE, endringer).kalkyle
    const flis = k.poster[1].linjer.at(-1)!
    expect(flis.timepris).toMatchObject({ id: "tp-flis", timesats: 820 })
    expect(k.poster[3].linjer.at(-1)).toMatchObject({ type: "jobb", fastpris: 3500, timerPerEnhet: 3 })
  })

  it("ny post med id, og linjer inn i den i samme forslag", () => {
    const { endringer, avvist } = tilKalkyleEndringer(
      [
        { type: "nyPost", navn: "Elektro", id: "ny-1" },
        { type: "leggTil", postId: "ny-1", linje: { beskrivelse: "Varmekabelmatte", type: "materiell", antall: 1, enhet: "stk", innpris: 2490 } },
      ],
      MOCK_KALKYLE,
      kontekst
    )
    expect(avvist).toBe(0)
    const etter = beregnKalkyle(brukEndringer(MOCK_KALKYLE, endringer).kalkyle)
    expect(etter.totalt.salgEksMva - beregnKalkyle(MOCK_KALKYLE).totalt.salgEksMva).toBeCloseTo(2490 * 1.15, 6)
  })

  it("endringer mot poster eller linjer som ikke finnes avvises", () => {
    const { endringer, avvist } = tilKalkyleEndringer(
      [
        { type: "fjern", postId: "membran", linjeId: "finnes-ikke" },
        { type: "leggTil", postId: "finnes-ikke", linje: { beskrivelse: "X", type: "arbeid", antall: 1 } },
        { type: "prising", felt: "timesats", verdi: 800 },
      ],
      MOCK_KALKYLE,
      kontekst
    )
    expect(avvist).toBe(2)
    expect(endringer).toEqual([{ type: "prising", felt: "timesats", verdi: 800 }])
  })
})

describe("SmartKI – sikkerhetsnett rundt modellen", () => {
  it("innpris uten treff i prisfilene merkes som anslag; pris fra prisfil gjør ikke", () => {
    const { endringer } = tilKalkyleEndringer(
      [
        { type: "leggTil", postId: "membran", linje: { beskrivelse: "Fugemasse", type: "materiell", antall: 2, enhet: "stk", innpris: 219 } },
        { type: "leggTil", postId: "membran", linje: { beskrivelse: "Varmekabelmatte 6 m²", type: "materiell", antall: 1, enhet: "stk", innpris: 2490 } },
      ],
      MOCK_KALKYLE,
      kontekst
    )
    expect(endringer.map((e) => e.type === "leggTil" && e.linje.anslag)).toEqual([true, false])
  })

  it("en tom ny post droppes; en ny post med linjer beholdes", () => {
    const tom = tilKalkyleEndringer([{ type: "nyPost", navn: "Toalett", id: "ny-1" }], MOCK_KALKYLE, kontekst)
    expect(tom.endringer).toEqual([])
    const medLinje = tilKalkyleEndringer(
      [
        { type: "nyPost", navn: "Toalett", id: "ny-1" },
        { type: "leggTil", postId: "ny-1", linje: { beskrivelse: "Montering av toalett", type: "arbeid", antall: 3, enhet: "t" } },
      ],
      MOCK_KALKYLE,
      kontekst
    )
    expect(medLinje.endringer).toHaveLength(2)
  })

  it("tekniske id-er vaskes ut av teksten, vanlige ord står", () => {
    expect(fjernIder("Nå står «Toalett» (ny-1) uten noe utført.", MOCK_KALKYLE, kontekst)).toBe("Nå står «Toalett» uten noe utført.")
    expect(fjernIder("Skal det legges på linjeId riving-riving?", MOCK_KALKYLE, kontekst)).toBe("Skal det legges på?")
    expect(fjernIder("Jeg legger 4 timer ekstra riving inn under Riving og rigg.", MOCK_KALKYLE, kontekst)).toBe(
      "Jeg legger 4 timer ekstra riving inn under Riving og rigg."
    )
    expect(fjernIder("Bytter membran-veggfliser til 60×60.", MOCK_KALKYLE, kontekst)).toBe("Bytter til 60×60.")
  })
})

describe("proposeWithRepair", () => {
  function falskModell(svar: string[], sekunderPerKall = 1) {
    let klokke = 0
    const kall: Array<{ messages: LlmMessage[]; timeoutMs: number }> = []
    return {
      kall,
      now: () => klokke,
      callModel: async (messages: LlmMessage[], timeoutMs: number) => {
        kall.push({ messages, timeoutMs })
        klokke += sekunderPerKall * 1000
        return { content: svar[kall.length - 1] ?? "", model: "test" }
      },
    }
  }

  it("ett gyldig svar gir ingen reparasjon", async () => {
    const m = falskModell([JSON.stringify({ svar: "Ok" })])
    const r = await proposeWithRepair({ messages: [], parse: parseSmartkiSvar, repairInstruction: () => "fiks", deadline: 110_000, ...m })
    expect(r).toMatchObject({ ok: true, repaired: false })
    expect(m.kall).toHaveLength(1)
    expect(m.kall[0].timeoutMs).toBe(90_000)
  })

  it("ugyldig svar repareres med feilene og resten av tiden", async () => {
    const m = falskModell(["tull", JSON.stringify({ svar: "Ok nå" })], 5)
    const r = await proposeWithRepair({ messages: [{ role: "user", content: "spm" }], parse: parseSmartkiSvar, repairInstruction: (i) => `fiks: ${i[0].message}`, deadline: 110_000, ...m })
    expect(r).toMatchObject({ ok: true, repaired: true })
    expect(m.kall[1].messages.at(-1)?.content).toContain("fiks: Svaret var ikke gyldig JSON")
    expect(m.kall[1].timeoutMs).toBe(105_000)
  })

  it("ingen reparasjon når det er for lite tid igjen", async () => {
    const m = falskModell(["tull"], 95)
    const r = await proposeWithRepair({ messages: [], parse: parseSmartkiSvar, repairInstruction: () => "fiks", deadline: 110_000, ...m })
    expect(r).toMatchObject({ ok: false, repaired: false })
    expect(m.kall).toHaveLength(1)
  })
})

describe("SmartKI: nye poster får egne id-er", () => {
  const nyPostMedLinje = (navn: string, linje: string) =>
    parseSmartkiSvar(
      JSON.stringify({
        svar: `Legger til ${navn}.`,
        endringer: [
          { type: "nyPost", id: "ny-1", navn },
          { type: "leggTil", postId: "ny-1", linje: { beskrivelse: linje, type: "materiell", antall: 1, enhet: "stk", innpris: 1000 } },
        ],
      })
    )

  it("to forslag på rad med «ny-1»: den andre posten får linja si, ikke den første", () => {
    const forste = nyPostMedLinje("Varmekabler", "Varmekabelmatte")
    if (!forste.ok) throw new Error("parse")
    const k1 = brukEndringer(MOCK_KALKYLE, tilKalkyleEndringer(forste.value.endringer, MOCK_KALKYLE, kontekst).endringer).kalkyle

    const andre = nyPostMedLinje("Ventilasjon", "Vifte")
    if (!andre.ok) throw new Error("parse")
    const { endringer, avvist } = tilKalkyleEndringer(andre.value.endringer, k1, kontekst)
    expect(avvist).toBe(0)
    const k2 = brukEndringer(k1, endringer).kalkyle

    const post = (navn: string) => k2.poster.find((p) => p.navn === navn)!
    expect(post("Varmekabler").linjer.map((l) => l.beskrivelse)).toEqual(["Varmekabelmatte"])
    expect(post("Ventilasjon").linjer.map((l) => l.beskrivelse)).toEqual(["Vifte"])
    expect(new Set(k2.poster.map((p) => p.id)).size).toBe(k2.poster.length)
  })

  it("linjer som står før den nye posten i svaret, havner likevel i den", () => {
    const r = parseSmartkiSvar(
      JSON.stringify({
        svar: "Ok.",
        endringer: [
          { type: "leggTil", postId: "riving", linje: { beskrivelse: "Vifte", type: "materiell", antall: 1, enhet: "stk", innpris: 900 } },
          { type: "nyPost", id: "riving", navn: "Ventilasjon" },
        ],
      })
    )
    if (!r.ok) throw new Error("parse")
    const k = brukEndringer(MOCK_KALKYLE, tilKalkyleEndringer(r.value.endringer, MOCK_KALKYLE, kontekst).endringer).kalkyle
    // «riving» finnes fra før: den nye posten får en annen id, og linja følger den nye posten.
    expect(k.poster.find((p) => p.navn === "Ventilasjon")!.linjer.map((l) => l.beskrivelse)).toEqual(["Vifte"])
    expect(k.poster.find((p) => p.id === "riving")!.linjer.some((l) => l.beskrivelse === "Vifte")).toBe(false)
  })
})

describe("SmartKI: grensene følger editoren", () => {
  it("lange prosjektnavn og varenavn forkortes i stedet for å avvise forespørselen", () => {
    const langtNavn = "ROBUST VÅTROMSMEMBRAN 15KG – ".repeat(10)
    const kalkyle: Kalkyle = {
      ...MOCK_KALKYLE,
      poster: MOCK_KALKYLE.poster.map((p, i) => (i === 0 ? { ...p, linjer: [{ ...p.linjer[0], beskrivelse: langtNavn }] } : p)),
    }
    const r = smartkiForesporselSkjema.safeParse({
      generationId: crypto.randomUUID(),
      sporsmal: "Hva koster dette?",
      prosjektNavn: "Totalrenovering av bad og vaskerom i underetasjen, Fjellveien 12, 0123 Oslo – ".repeat(3),
      kalkyle,
    })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data.kalkyle.poster[0].linjer[0].beskrivelse.length).toBeLessThanOrEqual(SMARTKI_GRENSER.tekst)
    expect(r.data.prosjektNavn!.length).toBeLessThanOrEqual(SMARTKI_GRENSER.tekst)
  })

  it("en kalkyle på 40 poster med 100 linjer i én post er innenfor", () => {
    const kalkyle: Kalkyle = {
      ...MOCK_KALKYLE,
      poster: Array.from({ length: 40 }, (_, p) => ({
        id: `p${p}`,
        navn: `Post ${p}`,
        rekkefolge: p,
        linjer: Array.from({ length: p === 0 ? 100 : 2 }, (_, l) => ({
          id: `p${p}-l${l}`,
          beskrivelse: `Linje ${l}`,
          type: "materiell" as const,
          antall: 1,
          enhet: "stk" as const,
          innpris: 100,
        })),
      })),
    }
    expect(smartkiForesporselSkjema.safeParse({ generationId: crypto.randomUUID(), sporsmal: "Sjekk", kalkyle }).success).toBe(true)
  })

  it("tall over taket fra modellen droppes, så neste forespørsel ikke avvises", () => {
    const r = parseSmartkiSvar(
      JSON.stringify({
        svar: "Ok.",
        endringer: [
          { type: "endre", postId: "membran", linjeId: "membran-veggfliser", patch: { paslag: 2500 } },
          { type: "prising", felt: "timesats", verdi: 5e9 },
          { type: "endre", postId: "membran", linjeId: "membran-veggfliser", patch: { paslag: 20 } },
        ],
      })
    )
    if (!r.ok) throw new Error("parse")
    expect(r.value.endringer).toHaveLength(1)
    expect(r.value.forkastet).toBe(2)
  })
})
