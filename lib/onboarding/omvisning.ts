/**
 * Omvisningen: stegene i den guidede turen, «Kom i gang»-listen og hvor kortet
 * skal stå i forhold til det som vises fram. Ren logikk uten React, så det kan
 * testes. Selve visningen ligger i components/onboarding/tutorial-wizard.tsx.
 *
 * Målene finnes via `data-tour`-attributter i appen. Finnes ikke målet (brukeren
 * er et annet sted), står kortet nede i hjørnet med instruksen og «Hopp over» —
 * turen stopper aldri opp.
 */

export type TurIkon = "prosjekter" | "prosjekt" | "kalkyle" | "okonomi" | "bedrift" | "logo"

/** Det turen vet om firmaet: nyeste prosjekt (for «Hopp over») og om kalkylemodulen er på. */
export type TurKontekst = {
  prosjekt: { id: string; navn: string } | null
  kalkyle: boolean
}

/** Det turen ser av appen akkurat nå. */
export type Side = {
  sti: string
  /** Den åpne fanen på prosjektsiden, eller null. */
  aktivFane: string | null
}

export type TurSteg = {
  key: string
  ikon: TurIkon
  tittel: string
  tekst: string
  /**
   * Det brukeren skal trykke på, i prioritert rekkefølge. Et reservemål brukes
   * først når det beste ikke har dukket opp etter en stund.
   */
  mal: string[]
  /** Neste trykk i samme steg (punktet i «Mer»-menyen). Synes det, er det målet. */
  deretter?: string
  /** Steget er gjort når appen er her. Uten: brukeren trykker «Ferdig». */
  ferdig?: (side: Side) => boolean
  /** Der «Hopp over» tar brukeren. Null = steget kan ikke gjøres nå; gå videre. */
  hopp?: (side: Side) => string | null
}

/** En prosjektside (ikke veiviseren for nytt prosjekt). */
export const PROSJEKTSIDE = /^\/prosjekter\/(?!ny$)[^/]+$/

/**
 * Turen er interaktiv: brukeren trykker selv i appen, lysfeltet viser hvor,
 * og steget er gjort når appen er der (adressen, den åpne fanen) — uansett
 * hvordan brukeren kom dit. Fem korte steg: prosjektene, kalkylen og
 * oppsettet av bedriften.
 */
export function turStegFor(k: TurKontekst): TurSteg[] {
  const fane = k.kalkyle ? "kalkyle" : "okonomi"
  return [
    {
      key: "prosjekter",
      ikon: "prosjekter",
      tittel: "Prosjektene dine",
      tekst: "Trykk på «Prosjekter». Der ligger alle jobbene dine.",
      mal: ['[data-tour="prosjekter"]'],
      ferdig: (s) => s.sti === "/prosjekter" || s.sti.startsWith("/prosjekter/"),
      hopp: () => "/prosjekter",
    },
    {
      key: "prosjekt",
      ikon: "prosjekt",
      tittel: k.prosjekt ? "Åpne et prosjekt" : "Lag ditt første prosjekt",
      tekst: k.prosjekt
        ? "Trykk på et prosjekt for å åpne det."
        : "Trykk «Nytt prosjekt» og fyll inn det viktigste. Turen fortsetter når prosjektet er laget.",
      mal: ['[data-tour="prosjekt-kort"]', '[data-tour="nytt-prosjekt-side"]'],
      ferdig: (s) => PROSJEKTSIDE.test(s.sti),
      hopp: () => (k.prosjekt ? `/prosjekter/${k.prosjekt.id}` : null),
    },
    {
      key: "kalkyle",
      ikon: k.kalkyle ? "kalkyle" : "okonomi",
      tittel: k.kalkyle ? "Kalkylen" : "Økonomi",
      tekst: k.kalkyle
        ? "Trykk på «Kalkyle». Her regner du ut jobben, og tilbudet lages rett fra den."
        : "Trykk på «Økonomi». Her lager du tilbud og fakturerer prosjektet.",
      mal: [`[data-tour="fane-${fane}"]`],
      ferdig: (s) => PROSJEKTSIDE.test(s.sti) && s.aktivFane === fane,
      hopp: (s) =>
        PROSJEKTSIDE.test(s.sti)
          ? `${s.sti}?tab=${fane}`
          : k.prosjekt
            ? `/prosjekter/${k.prosjekt.id}?tab=${fane}`
            : null,
    },
    {
      key: "bedrift",
      ikon: "bedrift",
      tittel: "Sett opp bedriften",
      tekst: "Trykk på «Mer», og så på «Bedriftsprofil».",
      mal: ['[data-tour="mer"]'],
      deretter: '[data-tour="mer-/min-bedrift/bedriftsprofil"]',
      ferdig: (s) => s.sti === "/min-bedrift/bedriftsprofil",
      hopp: () => "/min-bedrift/bedriftsprofil",
    },
    {
      key: "logo",
      ikon: "logo",
      tittel: "Logo og firmainfo",
      tekst: "Her legger du inn firmainformasjon og logo, som kommer med på tilbudene. Logo er valgfritt, og du kan gjøre det når som helst.",
      mal: ['[data-tour="logo"]'],
    },
  ]
}

/** Alle selektorer turen kan bruke, uansett firma (til testen som sjekker at målene finnes). */
export function alleMal(): string[] {
  const prosjekt = { id: "x", navn: "x" }
  const varianter = [{ prosjekt, kalkyle: true }, { prosjekt, kalkyle: false }, { prosjekt: null, kalkyle: true }]
  return [
    ...new Set(
      varianter.flatMap((k) => turStegFor(k).flatMap((s) => [...s.mal, ...(s.deretter ? [s.deretter] : [])]))
    ),
  ]
}

// ---------------------------------------------------------------------------
// «Kom i gang»-listen
// ---------------------------------------------------------------------------

export type KomIGangKey = "profil" | "prosjekt" | "tilbud" | "timer" | "ansatte"

export type KomIGangPunkt = {
  key: KomIGangKey
  tittel: string
  tekst: string
  href: string
  /** Fint å gjøre, men trengs ikke for at listen er fullført (ikke alle har logo). */
  valgfri?: boolean
}

export const KOM_I_GANG: KomIGangPunkt[] = [
  {
    key: "prosjekt",
    tittel: "Opprett det første prosjektet",
    tekst: "Samler tilbud, timer og dokumenter.",
    href: "/prosjekter/ny",
  },
  {
    key: "tilbud",
    tittel: "Send det første tilbudet",
    tekst: "Kunden kan godkjenne rett fra e-posten.",
    href: "/nytt-tilbud",
  },
  {
    key: "timer",
    tittel: "Før de første timene",
    tekst: "Stemple inn, eller før i etterkant.",
    href: "/timeforing",
  },
  {
    key: "ansatte",
    tittel: "Inviter en ansatt",
    tekst: "De fører timer og ser prosjektene sine.",
    href: "/min-bedrift/ansatte-og-roller",
  },
  {
    key: "profil",
    tittel: "Legg inn logo og firmainfo",
    tekst: "Vises på tilbud og i e-post til kunden.",
    href: "/min-bedrift/bedriftsprofil",
    valgfri: true,
  },
]

/** Det listen bygger på — hentet fra databasen, avkrysset når det faktisk er gjort. */
export type KomIGangTall = {
  /** Logo eller adresse er lagt inn (org.nr. og telefon settes ved registrering og teller ikke). */
  harProfil: boolean
  prosjekter: number
  /** Tilbud som ikke er utkast. */
  tilbudSendt: number
  timer: number
  brukere: number
  ventendeInvitasjoner: number
}

/** Hvor langt firmaet har kommet. Valgfrie punkter teller ikke med. */
export function komIGangFremdrift(status: Record<KomIGangKey, boolean>) {
  const kreves = KOM_I_GANG.filter((punkt) => !punkt.valgfri)
  const gjort = kreves.filter((punkt) => status[punkt.key]).length
  return { gjort, antall: kreves.length, ferdig: gjort === kreves.length }
}

export function komIGangStatus(tall: KomIGangTall): Record<KomIGangKey, boolean> {
  return {
    profil: tall.harProfil,
    prosjekt: tall.prosjekter > 0,
    tilbud: tall.tilbudSendt > 0,
    timer: tall.timer > 0,
    ansatte: tall.brukere > 1 || tall.ventendeInvitasjoner > 0,
  }
}

// ---------------------------------------------------------------------------
// Plassering av kortet
// ---------------------------------------------------------------------------

export type Rekt = { x: number; y: number; b: number; h: number }
export type KortPlass = {
  x: number
  y: number
  /** Bredden kortet skal ha (fast på PC, skjermbredde på mobil). */
  b: number
  side: "hoyre" | "under" | "over" | "venstre" | "midt" | "hjorne" | "bunn" | "topp"
}

const AVSTAND = 14
const KANT = 12

const klem = (verdi: number, min: number, max: number) => Math.min(Math.max(verdi, min), Math.max(min, max))

/**
 * Hvor kortet skal stå. PC: ved siden av målet (høyre, under, over, venstre —
 * første som får plass HELT innenfor skjermen). Mobil: dokket nederst, eller
 * øverst når målet selv ligger i nedre halvdel (bunnmenyen), så det aldri
 * dekker det som vises.
 *
 * Kortet havner aldri utenfor skjermen, heller ikke når målet gjør det (en
 * knapp under kanten før siden har rullet dit): da legges det nederst eller
 * øverst, på den siden målet er.
 */
export function plasserKort(
  mal: Rekt | null,
  kort: { b: number; h: number },
  vindu: { b: number; h: number },
  mobil: boolean
): KortPlass {
  if (mobil) {
    const b = vindu.b - KANT * 2
    const nede = mal !== null && mal.y + mal.h / 2 > vindu.h * 0.5
    return nede
      ? { x: KANT, y: KANT, b, side: "topp" }
      : { x: KANT, y: Math.max(KANT, vindu.h - kort.h - KANT), b, side: "bunn" }
  }

  const b = kort.b
  // Er kortet høyere enn skjermen (liggende telefon), legges det øverst — aldri over kanten.
  const maksX = Math.max(KANT, vindu.b - b - KANT)
  const maksY = Math.max(KANT, vindu.h - kort.h - KANT)
  // Uten mål (brukeren er et annet sted, eller målet laster): nede i hjørnet,
  // der kortet ikke står i veien for det brukeren holder på med.
  if (!mal) return { x: maksX, y: maksY, b, side: "hjorne" }

  const midtY = mal.y + mal.h / 2
  const midtX = mal.x + mal.b / 2
  const yVedSiden = klem(midtY - kort.h / 2, KANT, maksY)
  const xOverUnder = klem(midtX - b / 2, KANT, maksX)
  const passer = (x: number, y: number) => x >= KANT && y >= KANT && x <= maksX && y <= maksY

  // Ved siden av gir bare mening når målet faktisk er på skjermen i høyden.
  const synligIHoyden = mal.y + mal.h > 0 && mal.y < vindu.h
  const hoyre = mal.x + mal.b + AVSTAND
  if (synligIHoyden && passer(hoyre, yVedSiden)) return { x: hoyre, y: yVedSiden, b, side: "hoyre" }
  const under = mal.y + mal.h + AVSTAND
  if (passer(xOverUnder, under)) return { x: xOverUnder, y: under, b, side: "under" }
  const over = mal.y - AVSTAND - kort.h
  if (passer(xOverUnder, over)) return { x: xOverUnder, y: over, b, side: "over" }
  const venstre = mal.x - AVSTAND - b
  if (synligIHoyden && passer(venstre, yVedSiden)) return { x: venstre, y: yVedSiden, b, side: "venstre" }

  // Ingen plass ved siden av. Er målet utenfor skjermen, legges kortet ved
  // kanten det kommer inn fra; fyller målet skjermen, på motsatt halvdel.
  const y =
    mal.y >= vindu.h ? maksY : mal.y + mal.h <= 0 ? KANT : midtY > vindu.h / 2 ? KANT : maksY
  return { x: klem((vindu.b - b) / 2, KANT, maksX), y, b, side: "midt" }
}

/** Glir et rektangel mot et annet (k = 0…1 av veien). */
export function glid(fra: Rekt, til: Rekt, k: number): Rekt {
  return {
    x: fra.x + (til.x - fra.x) * k,
    y: fra.y + (til.y - fra.y) * k,
    b: fra.b + (til.b - fra.b) * k,
    h: fra.h + (til.h - fra.h) * k,
  }
}
