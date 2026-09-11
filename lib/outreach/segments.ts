// Salgssegmentene og fagkartet maskinen jobber etter.
//
// Et segment er «hvem vi selger til og hvordan»: hvilke næringskoder og
// firmastørrelser vi henter fra Brønnøysund, og hvilke organisasjonsformer som
// i det hele tatt kan motta kald e-post. Alt som styrer utvalget ligger her, så
// importen, portene og (senere) skrivemotoren leser samme sannhet.
//
// Næringskodene er SN2025 — Brønnøysund gikk over i 2025, og gamle SN2007-koder
// som «41.2» gir 0 treff i API-et nå (verifisert 2026-09-11).

export const SEGMENT_KEYS = ["handverker", "regnskapspartner"] as const
export type SegmentKey = (typeof SEGMENT_KEYS)[number]

export type Segment = {
  key: SegmentKey
  label: string
  /** Næringskode-prefikser for Brreg-søket (matches på prefiks). */
  naeringskoder: string[]
  /** Ansatte-intervall. Brreg godtar bare 0, 1 eller >4 i søket (1–4 skjules). */
  fraAntallAnsatte: number
  tilAntallAnsatte: number
  /** Organisasjonsformer som kan få kald e-post. ENK er en fysisk person
   *  (markedsføringsloven § 15), NUF er et utenlandsk foretak. */
  orgForms: readonly string[]
}

export const SEGMENTS: Record<SegmentKey, Segment> = {
  handverker: {
    key: "handverker",
    label: "Håndverkere 5–20",
    naeringskoder: ["41", "43"],
    fraAntallAnsatte: 5,
    tilAntallAnsatte: 20,
    orgForms: ["AS", "ASA"],
  },
  regnskapspartner: {
    key: "regnskapspartner",
    label: "Regnskapskontor (partner)",
    // 69.202 Regnskapsføring og bokføring — 69.201 er revisjon i SN2025.
    naeringskoder: ["69.202"],
    fraAntallAnsatte: 1,
    tilAntallAnsatte: 30,
    orgForms: ["AS", "ASA"],
  },
}

export function isSegmentKey(value: unknown): value is SegmentKey {
  return typeof value === "string" && (SEGMENT_KEYS as readonly string[]).includes(value)
}

export function getSegment(key: string | null | undefined): Segment {
  return isSegmentKey(key) ? SEGMENTS[key] : SEGMENTS.handverker
}

// ── Fag (SN2025) ────────────────────────────────────────────────────────────

export const TRADE_KEYS = [
  "bygg",
  "elektro",
  "ror",
  "varmepumpe",
  "ventilasjon",
  "snekker",
  "gulv",
  "maler",
  "tak",
  "mur",
  "grunnarbeid",
  "anlegg",
  "regnskap",
  "annet",
] as const
export type TradeKey = (typeof TRADE_KEYS)[number]

export const TRADE_LABELS: Record<TradeKey, string> = {
  bygg: "Bygg og tømrer",
  elektro: "Elektro",
  ror: "Rørlegger",
  varmepumpe: "Varmepumpe og peis",
  ventilasjon: "Ventilasjon",
  snekker: "Snekker",
  gulv: "Gulv og tapet",
  maler: "Maler",
  tak: "Tak",
  mur: "Mur",
  grunnarbeid: "Grunnarbeid",
  anlegg: "Anlegg",
  regnskap: "Regnskap",
  annet: "Annet",
}

/** Fagvalg i «Importer liste». `codes` sendes rett til Brreg som næringskode-prefikser. */
export const IMPORT_TRADE_OPTIONS: Array<{ value: string; label: string; codes: string[] }> = [
  { value: "alle", label: "Alle håndverksfag (41 + 43)", codes: ["41", "43"] },
  { value: "bygg", label: "Bygg og tømrer (41.000)", codes: ["41"] },
  { value: "elektro", label: "Elektro (43.210)", codes: ["43.210"] },
  { value: "ror", label: "Rørlegger (43.221)", codes: ["43.221"] },
  { value: "varmepumpe", label: "Varmepumpe og peis (43.222)", codes: ["43.222"] },
  { value: "ventilasjon", label: "Ventilasjon (43.223)", codes: ["43.223"] },
  { value: "snekker", label: "Snekker (43.320)", codes: ["43.320"] },
  { value: "gulv", label: "Gulv og tapet (43.330)", codes: ["43.330"] },
  { value: "maler", label: "Maler (43.340)", codes: ["43.340"] },
  { value: "tak", label: "Tak (43.410)", codes: ["43.410"] },
  { value: "mur", label: "Mur (43.910)", codes: ["43.910"] },
  { value: "grunnarbeid", label: "Grunnarbeid (43.120)", codes: ["43.120"] },
]

/** SN2025-kode (sifrene, uten punktum) → fag. Lengste prefiks vinner. */
const SN2025_TRADE_PREFIXES: Array<[string, TradeKey]> = [
  ["43210", "elektro"],
  ["43221", "ror"],
  ["43222", "varmepumpe"],
  ["43223", "ventilasjon"],
  ["43320", "snekker"],
  ["43330", "gulv"],
  ["43340", "maler"],
  ["43410", "tak"],
  ["43910", "mur"],
  ["43120", "grunnarbeid"],
  ["69202", "regnskap"],
  ["41", "bygg"],
  ["42", "anlegg"],
]

/** Nøkkelord i næringsbeskrivelsen — brukes først, fordi beskrivelsen er
 *  entydig mens samme sifre kan bety forskjellige fag i SN2007 og SN2025
 *  (43.910 var takarbeid i SN2007, er murerarbeid i SN2025). */
const TRADE_DESCRIPTION_RULES: Array<[RegExp, TradeKey]> = [
  [/elektr/, "elektro"],
  [/rørlegg|rorlegg|vvs|sanitær/, "ror"],
  [/varmepumpe|kuldeanlegg|peis/, "varmepumpe"],
  [/ventilasjon/, "ventilasjon"],
  [/snekker/, "snekker"],
  [/gulvlegging|tapetsering/, "gulv"],
  [/maler|glassarbeid/, "maler"],
  [/takarbeid|taktekk|blikkenslag/, "tak"],
  [/murer/, "mur"],
  [/grunnarbeid/, "grunnarbeid"],
  [/regnskapsføring|bokføring/, "regnskap"],
  [/oppføring av bygninger|tømrer|tomrer/, "bygg"],
  [/veier|jernbane|broer|tunneler|vann- og kloakk|anlegg/, "anlegg"],
]

export function resolveTrade(input: {
  naceCode?: string | null
  naceDescription?: string | null
}): TradeKey {
  const description = (input.naceDescription || "").toLowerCase()
  for (const [pattern, trade] of TRADE_DESCRIPTION_RULES) {
    if (description && pattern.test(description)) return trade
  }
  const digits = (input.naceCode || "").replace(/\D/g, "")
  if (digits) {
    for (const [prefix, trade] of SN2025_TRADE_PREFIXES) {
      if (digits.startsWith(prefix)) return trade
    }
  }
  return "annet"
}
