/**
 * Mock-data for kalkylemodulen (design-runden, ingen database ennå).
 * Tallene er fasit i tests/kalkyle: salg 90 750 kr eks. mva, kost 71 291 kr,
 * dekningsgrad 21,4 %, 50 timer.
 */
import type {
  Enhet,
  EtterkalkyleFaktisk,
  Kalkyle,
  KalkyleMal,
  LagretJobb,
  MalLinje,
  Prising,
  TilbudSnapshot,
  TimeprisValg,
} from "./types"

export const MOCK_PRISING: Prising = {
  timesats: 750,
  internKostPerTime: 480,
  paslagMateriell: 15,
  paslagUe: 10,
}

export const MOCK_PROSJEKT = {
  navn: "Bad 6 m² – Fjellveien 12",
  kunde: "Kari Hansen",
  adresse: "Fjellveien 12",
} as const

export const MOCK_KALKYLE: Kalkyle = {
  ...MOCK_PRISING,
  id: "kalkyle-fjellveien-12",
  prosjektId: "mock-prosjekt",
  poster: [
    {
      id: "riving",
      navn: "Riving og rigg",
      rekkefolge: 1,
      linjer: [
        { id: "riving-rigg", beskrivelse: "Rigg og drift", type: "arbeid", antall: 4, enhet: "t", innpris: null },
        { id: "riving-riving", beskrivelse: "Riving", type: "arbeid", antall: 12, enhet: "t", innpris: null },
        // m³ finnes ikke i enhetslista, så containeren føres som én rund sum.
        { id: "riving-container", beskrivelse: "Container 6 m³", type: "ue", antall: 1, enhet: "rs", innpris: 4200 },
      ],
    },
    {
      id: "membran",
      navn: "Membran og fliser",
      rekkefolge: 2,
      linjer: [
        { id: "membran-smoremembran", beskrivelse: "Smøremembran", type: "materiell", antall: 1, enhet: "sett", innpris: 3900 },
        { id: "membran-veggfliser", beskrivelse: "Veggfliser", type: "materiell", antall: 22, enhet: "m²", innpris: 389 },
        { id: "membran-gulvfliser", beskrivelse: "Gulvfliser", type: "materiell", antall: 7, enhet: "m²", innpris: 449 },
        { id: "membran-arbeid", beskrivelse: "Membran og flislegging", type: "arbeid", antall: 28, enhet: "t", innpris: null },
      ],
    },
    {
      id: "ror",
      navn: "Rør",
      rekkefolge: 3,
      linjer: [
        { id: "ror-rorlegger", beskrivelse: "Rørlegger komplett", type: "ue", antall: 1, enhet: "rs", innpris: 18500 },
      ],
    },
    {
      id: "innredning",
      navn: "Innredning",
      rekkefolge: 4,
      linjer: [
        { id: "innredning-innredning", beskrivelse: "Baderomsinnredning", type: "materiell", antall: 1, enhet: "stk", innpris: 8990 },
        { id: "innredning-montering", beskrivelse: "Montering", type: "arbeid", antall: 6, enhet: "t", innpris: null },
      ],
    },
  ],
}

export const MOCK_FIRMA = {
  navn: "Nordvik Bygg AS",
  orgnr: "123 456 789",
  epost: "post@nordvikbygg.no",
} as const

export const MOCK_TILBUD_META = {
  nummer: "T-2026-041",
  dato: "2026-10-15",
  gyldigTil: "2026-11-14",
  tittel: "Totalrenovering av bad, 6 m²",
  beskrivelse:
    "Riving av eksisterende bad, ny membran og flislegging av vegger og gulv, komplett rørleggerarbeid og montering av ny baderomsinnredning.",
  forbehold: [
    "Prisen er fastpris for arbeidet som er beskrevet over.",
    "Skader i underlag eller rør som oppdages under riving, er ikke med. Slike tillegg avtales skriftlig før arbeidet starter.",
    "Endringer som kunden ber om underveis, faktureres etter medgått tid og materiell.",
  ],
} as const

// ── Maler ────────────────────────────────────────────────────────────────

let linjeTeller = 0
function L(
  beskrivelse: string,
  type: MalLinje["type"],
  enhet: MalLinje["enhet"],
  fast: number,
  perEnhet: number,
  innpris: number | null = null,
): MalLinje {
  linjeTeller += 1
  return { id: `mal-linje-${linjeTeller}`, beskrivelse, type, enhet, innpris, mengde: { fast, perEnhet } }
}

/**
 * «Bad komplett» er laget slik at Areal 6 m² gir nøyaktig MOCK_KALKYLE
 * (veggfliser 4 + 3 × A, gulvfliser 1 + 1 × A, flislegging 10 + 3 × A t, riving 6 + 1 × A t).
 */
export const MOCK_MALER: KalkyleMal[] = [
  {
    id: "bad-komplett",
    navn: "Bad komplett",
    beskrivelse: "Riving, membran, flis på vegg og gulv, rørlegger og innredning.",
    parameter: { navn: "Areal", enhet: "m²", standard: 6, min: 2, max: 20, steg: 1 },
    antallGangerBrukt: 14,
    poster: [
      { id: "riving", navn: "Riving og rigg", rekkefolge: 1, linjer: [
        L("Rigg og drift", "arbeid", "t", 4, 0),
        L("Riving", "arbeid", "t", 6, 1),
        L("Container 6 m³", "ue", "rs", 1, 0, 4200),
      ] },
      { id: "membran", navn: "Membran og fliser", rekkefolge: 2, linjer: [
        L("Smøremembran", "materiell", "sett", 1, 0, 3900),
        L("Veggfliser", "materiell", "m²", 4, 3, 389),
        L("Gulvfliser", "materiell", "m²", 1, 1, 449),
        L("Membran og flislegging", "arbeid", "t", 10, 3),
      ] },
      { id: "ror", navn: "Rør", rekkefolge: 3, linjer: [
        L("Rørlegger komplett", "ue", "rs", 1, 0, 18500),
      ] },
      { id: "innredning", navn: "Innredning", rekkefolge: 4, linjer: [
        L("Baderomsinnredning", "materiell", "stk", 1, 0, 8990),
        L("Montering", "arbeid", "t", 6, 0),
      ] },
    ],
  },
  {
    id: "etterisolering-loft",
    navn: "Etterisolering loft",
    beskrivelse: "Isolasjon med ny dampsperre på kaldt loft.",
    parameter: { navn: "Areal", enhet: "m²", standard: 40, min: 10, max: 150, steg: 5 },
    antallGangerBrukt: 6,
    poster: [
      { id: "forberedelse", navn: "Forberedelse", rekkefolge: 1, linjer: [
        L("Rigg og tildekking", "arbeid", "t", 3, 0),
        L("Fjerne gammel isolasjon", "arbeid", "t", 2, 0.1),
      ] },
      { id: "isolasjon", navn: "Isolasjon", rekkefolge: 2, linjer: [
        L("Glassull 200 mm", "materiell", "m²", 0, 1.05, 89),
        L("Dampsperre", "materiell", "m²", 0, 1.1, 18),
        L("Legging og tetting", "arbeid", "t", 2, 0.25),
      ] },
      { id: "avslutning", navn: "Avslutning", rekkefolge: 3, linjer: [
        L("Lekter og tape", "materiell", "sett", 1, 0, 1200),
        L("Rydding og bortkjøring", "arbeid", "t", 3, 0),
      ] },
    ],
  },
  {
    id: "terrasse",
    navn: "Terrasse",
    beskrivelse: "Ny terrasse på punktfundament med bjelkelag og trykkimpregnerte bord.",
    parameter: { navn: "Areal", enhet: "m²", standard: 20, min: 6, max: 80, steg: 2 },
    antallGangerBrukt: 9,
    poster: [
      { id: "fundament", navn: "Fundament", rekkefolge: 1, linjer: [
        L("Punktfundament", "materiell", "stk", 4, 0.5, 450),
        L("Graving og støp", "arbeid", "t", 4, 0.3),
      ] },
      { id: "bjelkelag", navn: "Bjelkelag", rekkefolge: 2, linjer: [
        L("Konstruksjonsvirke", "materiell", "lm", 0, 3, 62),
        L("Bjelkelag", "arbeid", "t", 2, 0.6),
      ] },
      { id: "terrassebord", navn: "Terrassebord", rekkefolge: 3, linjer: [
        L("Terrassebord 28×120", "materiell", "m²", 0, 1.08, 289),
        L("Legging", "arbeid", "t", 0, 0.5),
      ] },
      { id: "trapp", navn: "Trapp og avslutning", rekkefolge: 4, linjer: [
        L("Trapp, 3 trinn", "materiell", "sett", 1, 0, 2400),
        L("Montering trapp og lister", "arbeid", "t", 5, 0),
      ] },
    ],
  },
  {
    id: "vindusbytte",
    navn: "Vindusbytte",
    beskrivelse: "Demontering av gamle vinduer, montering og tetting av nye, innvendig listing.",
    parameter: { navn: "Antall", enhet: "stk", standard: 6, min: 1, max: 30, steg: 1 },
    antallGangerBrukt: 11,
    poster: [
      { id: "demontering", navn: "Demontering", rekkefolge: 1, linjer: [
        L("Demontering og bortkjøring", "arbeid", "t", 1, 1),
      ] },
      { id: "vinduer", navn: "Nye vinduer", rekkefolge: 2, linjer: [
        L("Vindu 3-lags", "materiell", "stk", 0, 1, 7400),
      ] },
      { id: "montering", navn: "Montering og tetting", rekkefolge: 3, linjer: [
        L("Montering", "arbeid", "t", 0, 2.5),
        L("Fugemasse og tettelist", "materiell", "sett", 0, 1, 350),
      ] },
      { id: "listing", navn: "Listing", rekkefolge: 4, linjer: [
        L("Lister", "materiell", "lm", 0, 5, 45),
        L("Listing og sparkling", "arbeid", "t", 0, 1),
      ] },
    ],
  },
  {
    id: "kjokkenmontering",
    navn: "Kjøkkenmontering",
    beskrivelse: "Riving av gammelt kjøkken, montering av skap og benkeplate, elektriker og rørlegger.",
    parameter: { navn: "Løpemeter", enhet: "lm", standard: 4, min: 2, max: 12, steg: 0.5 },
    antallGangerBrukt: 4,
    poster: [
      { id: "riving", navn: "Riving", rekkefolge: 1, linjer: [
        L("Riving av gammelt kjøkken", "arbeid", "t", 4, 1),
        L("Container", "ue", "rs", 1, 0, 3500),
      ] },
      { id: "skap", navn: "Skap og benkeplate", rekkefolge: 2, linjer: [
        L("Montering av skap", "arbeid", "t", 2, 3),
        L("Benkeplate, tilpasning", "arbeid", "t", 2, 0.5),
        L("Monteringsmateriell", "materiell", "sett", 1, 0, 1500),
      ] },
      { id: "fag", navn: "Elektriker og rørlegger", rekkefolge: 3, linjer: [
        L("Elektriker", "ue", "rs", 1, 0, 9500),
        L("Rørlegger", "ue", "rs", 1, 0, 7800),
      ] },
    ],
  },
]

// ── Etterkalkyle ─────────────────────────────────────────────────────────

export const MOCK_SIGNERT_SNAPSHOT: TilbudSnapshot = {
  id: "snapshot-t-2026-041",
  kalkyle: MOCK_KALKYLE,
  detaljniva: "post",
  visTimer: true,
  sendtDato: "2026-09-12",
  signertDato: "2026-09-18",
  erLast: true,
}

/** Faktiske timer 15 / 37 / 0 / 7 (59 t), materiell 25 340 kr (fliser +749 kr), UE som kalkulert. */
export const MOCK_FAKTISK: EtterkalkyleFaktisk = {
  poster: [
    { postId: "riving", timer: 15, materiell: 0, ue: 4200 },
    { postId: "membran", timer: 37, materiell: 16350, ue: 0 },
    { postId: "ror", timer: 0, materiell: 0, ue: 18500 },
    { postId: "innredning", timer: 7, materiell: 8990, ue: 0 },
  ],
}

/** Innkjøp bak MOCK_FAKTISK, slik de vises i Etterkalkyle → Innkjøp. Sum 48 040 kr. */
export const MOCK_INNKJOP = [
  { id: "bilag-2207", leverandor: "Flis AS", tekst: "Vegg- og gulvfliser, flislim, fugemasse", postId: "membran", kilde: "Fiken · bilag 2207", belop: 12450 },
  { id: "bilag-2191", leverandor: "Byggvare AS", tekst: "Smøremembran, mansjetter og primer", postId: "membran", kilde: "Fiken · bilag 2191", belop: 3900 },
  { id: "bilag-2215", leverandor: "Baderom AS", tekst: "Baderomsinnredning", postId: "innredning", kilde: "Fiken · bilag 2215", belop: 8990 },
  { id: "manuell-1", leverandor: "Container Vest AS", tekst: "Container 6 m³, leie og levering", postId: "riving", kilde: "Manuell", belop: 4200 },
  { id: "bilag-2230", leverandor: "Rørlegger Berg AS", tekst: "Rørleggerarbeid komplett", postId: "ror", kilde: "Fiken · bilag 2230", belop: 18500 },
] as const

/** Et lite utdrag av «prisfilene» for søket i redigeringsarket. Erstattes av ekte prisfil-søk. */
export const MOCK_PRISFIL = [
  { id: "pf-1", beskrivelse: "Veggflis 30×60 hvit matt", enhet: "m²", innpris: 389, kilde: "Flis AS" },
  { id: "pf-2", beskrivelse: "Veggflis 60×60 lys grå", enhet: "m²", innpris: 529, kilde: "Flis AS" },
  { id: "pf-3", beskrivelse: "Gulvflis 20×20 grå, sklisikker", enhet: "m²", innpris: 449, kilde: "Flis AS" },
  { id: "pf-4", beskrivelse: "Flislim, 15 kg", enhet: "stk", innpris: 329, kilde: "Byggvare AS" },
  { id: "pf-5", beskrivelse: "Smøremembran, sett for bad", enhet: "sett", innpris: 3900, kilde: "Byggvare AS" },
  { id: "pf-6", beskrivelse: "Fugemasse, 5 kg", enhet: "stk", innpris: 219, kilde: "Flis AS" },
  { id: "pf-7", beskrivelse: "Varmekabelmatte, 6 m²", enhet: "sett", innpris: 2490, kilde: "Elektrogrossist AS" },
] as const satisfies ReadonlyArray<{ id: string; beskrivelse: string; enhet: Enhet; innpris: number; kilde: string }>

/** Reserve når bedriften ikke har lagt inn timepriser i Mine priser. Første er standard. */
export const MOCK_TIMEPRISER: TimeprisValg[] = [
  { id: "eksempel-tomrer", navn: "Tømrer", timesats: 750, internKost: 480 },
  { id: "eksempel-flislegger", navn: "Flislegger", timesats: 820, internKost: 520 },
  { id: "eksempel-laerling", navn: "Lærling", timesats: 550, internKost: 320 },
]

/** Reserve når bedriften ikke har lagrede jobber i Mine priser. */
export const MOCK_LAGREDE_JOBBER: LagretJobb[] = [
  { id: "eksempel-toalett", navn: "Montering av toalett", pris: 3500, timer: 3 },
  { id: "eksempel-servant", navn: "Montering av servant", pris: 2900, timer: 2.5 },
  { id: "eksempel-sluk", navn: "Bytte sluk", pris: 4800, timer: 4 },
  { id: "eksempel-silikon", navn: "Silikonfuging bad", pris: 1800, timer: 2 },
]
