import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

import { alleMal, glid, komIGangFremdrift, komIGangStatus, KOM_I_GANG, plasserKort, turStegFor } from "../../lib/onboarding/omvisning"

const ROT = join(__dirname, "../..")
const kilde = (fil: string) => readFileSync(join(ROT, fil), "utf8")

describe("turen", () => {
  it("hvert mål finnes som data-tour i appen", () => {
    const filer = [
      "components/app-sidebar.tsx",
      "components/nav-main.tsx",
      "components/mobile-bottom-nav.tsx",
      "components/nav-more-menu.tsx",
      "app/prosjekter/project-card.tsx",
      "app/prosjekter/project-list-row.tsx",
      "app/prosjekter/page.tsx",
      "app/prosjekter/[id]/project-tabs-shell.tsx",
      "app/min-bedrift/bedriftsprofil/bedriftsprofil-client.tsx",
    ]
      .map(kilde)
      .join("\n")
    for (const selektor of alleMal()) {
      const tour = /data-tour="([^"]+)"/.exec(selektor)?.[1]
      expect(tour, selektor).toBeTruthy()
      if (tour!.startsWith("fane-")) {
        expect(filer).toContain("data-tour={`fane-${tab.value}`}")
        expect(kilde("app/prosjekter/[id]/project-tab-aliases.ts")).toContain(`"${tour!.slice(5)}"`)
      } else if (tour!.startsWith("mer-")) {
        expect(filer).toContain("data-tour={`mer-${entry.href}`}")
        expect(kilde("lib/app-nav.tsx")).toContain(`href: "${tour!.slice(4)}"`)
      } else if (tour === "prosjekter") {
        expect(filer).toContain('tourId: "prosjekter"')
        expect(filer).toContain('"prosjekter" : undefined')
      } else {
        expect(filer.includes(`data-tour="${tour}"`) || filer.includes(`tourId="${tour}"`), tour).toBe(true)
      }
    }
  })

  it("maks fem steg: prosjektene, kalkylen og bedriften", () => {
    const steg = turStegFor({ prosjekt: { id: "p1", navn: "Bad" }, kalkyle: true })
    expect(steg.map((s) => s.key)).toEqual(["prosjekter", "prosjekt", "kalkyle", "bedrift", "logo"])
    expect(steg.length).toBeLessThanOrEqual(5)
    const utenKalkyle = turStegFor({ prosjekt: null, kalkyle: false })
    expect(utenKalkyle.length).toBeLessThanOrEqual(5)
    expect(utenKalkyle[2].mal).toEqual(['[data-tour="fane-okonomi"]'])
  })

  it("et steg er gjort når appen er der — uansett hvordan brukeren kom dit", () => {
    const [prosjekter, prosjekt, kalkyle, bedrift, logo] = turStegFor({ prosjekt: { id: "p1", navn: "Bad" }, kalkyle: true })
    expect(prosjekter.ferdig!({ sti: "/", aktivFane: null })).toBe(false)
    expect(prosjekter.ferdig!({ sti: "/prosjekter", aktivFane: null })).toBe(true)
    expect(prosjekt.ferdig!({ sti: "/prosjekter/ny", aktivFane: null })).toBe(false)
    expect(prosjekt.ferdig!({ sti: "/prosjekter/p9", aktivFane: "oversikt" })).toBe(true)
    expect(kalkyle.ferdig!({ sti: "/prosjekter/p9", aktivFane: "oversikt" })).toBe(false)
    expect(kalkyle.ferdig!({ sti: "/prosjekter/p9", aktivFane: "kalkyle" })).toBe(true)
    expect(bedrift.ferdig!({ sti: "/min-bedrift/bedriftsprofil", aktivFane: null })).toBe(true)
    // Siste steg avsluttes med «Ferdig».
    expect(logo.ferdig).toBeUndefined()
  })

  it("«Hopp over» tar brukeren dit steget fører", () => {
    const [, prosjekt, kalkyle, bedrift] = turStegFor({ prosjekt: { id: "p1", navn: "Bad" }, kalkyle: true })
    expect(prosjekt.hopp!({ sti: "/prosjekter", aktivFane: null })).toBe("/prosjekter/p1")
    // Står brukeren på et annet prosjekt, åpnes kalkylen der.
    expect(kalkyle.hopp!({ sti: "/prosjekter/p9", aktivFane: "oversikt" })).toBe("/prosjekter/p9?tab=kalkyle")
    expect(bedrift.hopp!({ sti: "/", aktivFane: null })).toBe("/min-bedrift/bedriftsprofil")
    // Uten prosjekt finnes det ikke noe å hoppe til.
    const tom = turStegFor({ prosjekt: null, kalkyle: true })
    expect(tom[1].hopp!({ sti: "/prosjekter", aktivFane: null })).toBeNull()
    expect(tom[1].tittel).toBe("Lag ditt første prosjekt")
  })

  it("ingen «KI» i teksten brukerne ser", () => {
    const k = { prosjekt: { id: "x", navn: "x" }, kalkyle: true }
    const tekst = [
      ...[k, { ...k, kalkyle: false }, { prosjekt: null, kalkyle: false }].flatMap((kontekst) =>
        turStegFor(kontekst).flatMap((s) => [s.tittel, s.tekst])
      ),
      ...KOM_I_GANG.flatMap((p) => [p.tittel, p.tekst]),
    ]
    for (const linje of tekst) expect(linje).not.toMatch(/\bKI\b|\bAI\b/)
  })
})

describe("Kom i gang", () => {
  it("fullført uten logo: firmainfo og logo er valgfritt", () => {
    const status = komIGangStatus({ harProfil: false, prosjekter: 1, tilbudSendt: 1, timer: 3, brukere: 2, ventendeInvitasjoner: 0 })
    expect(status.profil).toBe(false)
    expect(komIGangFremdrift(status)).toEqual({ gjort: 4, antall: 4, ferdig: true })
    expect(komIGangFremdrift({ ...status, timer: false }).ferdig).toBe(false)
    expect(KOM_I_GANG.find((p) => p.key === "profil")?.valgfri).toBe(true)
  })

  it("krysses av når det faktisk er gjort", () => {
    const tom = { harProfil: false, prosjekter: 0, tilbudSendt: 0, timer: 0, brukere: 1, ventendeInvitasjoner: 0 }
    expect(Object.values(komIGangStatus(tom)).every((v) => !v)).toBe(true)
    const status = komIGangStatus({ ...tom, prosjekter: 2, ventendeInvitasjoner: 1 })
    expect(status.prosjekt).toBe(true)
    expect(status.ansatte).toBe(true)
    expect(status.tilbud).toBe(false)
    // Én bruker (seg selv) er ikke en ansatt.
    expect(komIGangStatus({ ...tom, brukere: 1 }).ansatte).toBe(false)
  })
})

describe("plassering av kortet", () => {
  const vindu = { b: 1280, h: 800 }
  const kort = { b: 340, h: 200 }

  it("ved siden av sidemenyen, under en knapp øverst til høyre", () => {
    expect(plasserKort({ x: 8, y: 80, b: 240, h: 400 }, kort, vindu, false).side).toBe("hoyre")
    const knapp = plasserKort({ x: 1150, y: 70, b: 110, h: 36 }, kort, vindu, false)
    expect(knapp.side).toBe("under")
    expect(knapp.x + kort.b).toBeLessThanOrEqual(vindu.b - 12)
  })

  it("nede i hjørnet når målet mangler, så kortet ikke står i veien", () => {
    const plass = plasserKort(null, kort, vindu, false)
    expect(plass.side).toBe("hjorne")
    expect(plass.x + kort.b).toBe(vindu.b - 12)
    expect(plass.y + kort.h).toBe(vindu.h - 12)
  })

  it("mobil: dokket, og øverst når målet er bunnmenyen", () => {
    const telefon = { b: 390, h: 844 }
    expect(plasserKort({ x: 0, y: 780, b: 390, h: 64 }, kort, telefon, true).side).toBe("topp")
    const bunn = plasserKort({ x: 20, y: 120, b: 100, h: 40 }, kort, telefon, true)
    expect(bunn.side).toBe("bunn")
    expect(bunn.b).toBe(390 - 24)
  })

  it("aldri utenfor skjermen, heller ikke når målet er under kanten (Send tilbudet)", () => {
    const innenfor = (p: { x: number; y: number; b: number }) => {
      expect(p.x).toBeGreaterThanOrEqual(12)
      expect(p.y).toBeGreaterThanOrEqual(12)
      expect(p.x + p.b).toBeLessThanOrEqual(vindu.b - 12)
      expect(p.y + kort.h).toBeLessThanOrEqual(vindu.h - 12)
    }
    // «Send til kunde for signering» til høyre, langt under kanten.
    const under = plasserKort({ x: 1000, y: 1400, b: 260, h: 52 }, kort, vindu, false)
    innenfor(under)
    expect(under.y + kort.h).toBe(vindu.h - 12)
    // Over skjermen (rullet forbi).
    const over = plasserKort({ x: 1000, y: -300, b: 260, h: 52 }, kort, vindu, false)
    innenfor(over)
    expect(over.y).toBe(12)
    // Like ved bunnen: kortet går over knappen, helt synlig.
    const nederst = plasserKort({ x: 1000, y: 700, b: 260, h: 52 }, kort, vindu, false)
    expect(nederst.side).toBe("over")
    innenfor(nederst)
    // Et mål som fyller hele skjermen.
    innenfor(plasserKort({ x: 0, y: -100, b: 1280, h: 1200 }, kort, vindu, false))
    // Høyt kort på lav skjerm: fortsatt ikke under kanten.
    const lav = plasserKort({ x: 1000, y: 300, b: 260, h: 52 }, { b: 340, h: 260 }, { b: 1280, h: 420 }, false)
    expect(lav.y + 260).toBeLessThanOrEqual(420 - 12)
  })

  it("glir halvveis", () => {
    expect(glid({ x: 0, y: 0, b: 10, h: 10 }, { x: 100, y: 50, b: 30, h: 10 }, 0.5)).toEqual({ x: 50, y: 25, b: 20, h: 10 })
  })
})
