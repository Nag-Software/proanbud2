// EFO/NELFO 4.0-parser for prisfiler fra VVS-/elektrogrossister (Ahlsell,
// Brødrene Dahl, Onninen m.fl.). Formatet er semikolonseparert uten
// kolonneoverskrifter, med posisjonsbestemte felter definert i
// «EFO/NELFO Vareformat / Pristilbud versjon 4.0» (rev. 2010-11-25):
//
//   VH/PH = hodepost (én, første linje: selger, valuta, gyldighet)
//   VL/PL = varelinje (produkt + pris; pris i øre per PrisEnhet)
//   VX/PX = tilleggsinfo (bilder, FDV, vekt …) – hoppes over
//   VA/PA = alternativer/forpakning – hoppes over
//
// Semikolon er forbudt som tegn i feltene, så ren split(";") er trygg.
// Tegnsett er per spec CP1252/ISO-8859-1 – dekoding skjer før parseren.

export type EfoParsedRow = {
  produkt: string
  enhet?: string
  veil_pris?: number
  netto_pris?: number
  rabatt?: number
  varegruppekode?: string
  leverandor_id?: string
  ean?: string
}

export type EfoStats = {
  productLines: number
  imported: number
  skippedDiscontinued: number
  skippedSurcharge: number
  skippedNoPrice: number
  skippedInvalid: number
}

export type EfoParseResult =
  | {
      ok: true
      kind: "varefil" | "pristilbud"
      supplierName: string
      fromDate: string | null
      toDate: string | null
      rows: EfoParsedRow[]
      stats: EfoStats
    }
  | { ok: false; error: string }

// PrisEnhetstabell (UN Common Code) fra spesifikasjonen → korte norske enheter
// slik de ellers brukes i tilbudslinjer i appen.
const PRICE_UNIT_MAP: Record<string, string> = {
  EA: "stk",
  MTR: "m",
  OP: "par",
  PK: "pk",
  SET: "sett",
  KGM: "kg",
  LTR: "l",
  CT: "kartong",
  RO: "rull",
  RL: "snelle",
  BG: "pose",
  BX: "boks",
  PF: "pall",
  BD: "brett",
  BK: "kurv",
  BQ: "flaske",
  CA: "kanne",
  ST: "ark",
}

function mapUnit(code: string, text: string): string | undefined {
  const mapped = PRICE_UNIT_MAP[code.toUpperCase()]
  if (mapped) return mapped
  const fallback = (text || code).trim().toLowerCase()
  return fallback || undefined
}

// Numerisk feltverdi med implisitte desimaler («desimaltegn brukes ikke»):
// Pris har 2 desimaler (2050 = kr 20,50), Rabatt har 2 (1550 = 15,50 %).
function parseImplicitDecimal(raw: string, decimals: number): number | null {
  const trimmed = raw.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const n = parseInt(trimmed, 10)
  if (!Number.isFinite(n)) return null
  return n / 10 ** decimals
}

function firstNonEmptyLine(text: string): string | null {
  let start = 0
  const len = text.length
  while (start < len) {
    let end = text.indexOf("\n", start)
    if (end === -1) end = len
    const line = text.slice(start, end).replace(/^\uFEFF/, "").trim()
    if (line) return line
    start = end + 1
  }
  return null
}

/**
 * Kjapp sjekk (kun første linje) på om teksten er en EFO/NELFO-fil.
 * Returnerer filtype og versjon, eller null hvis formatet er noe annet.
 */
export function detectEfoNelfo(
  text: string
): { kind: "varefil" | "pristilbud"; version: string } | null {
  const first = firstNonEmptyLine(text)
  if (!first) return null
  const fields = first.split(";")
  const postType = (fields[0] ?? "").trim().toUpperCase()
  const format = (fields[1] ?? "").trim().toUpperCase()
  if (format !== "EFONELFO") return null
  if (postType === "VH") return { kind: "varefil", version: (fields[2] ?? "").trim() }
  if (postType === "PH") return { kind: "pristilbud", version: (fields[2] ?? "").trim() }
  return null
}

/**
 * Parser en komplett EFO/NELFO 4.0 varefil (VH/VL) eller pristilbudsfil
 * (PH/PL) til prisrader klare for opplasting. Feil rapporteres som norske,
 * brukervennlige meldinger – aldri exceptions.
 */
export function parseEfoNelfo(text: string): EfoParseResult {
  const detected = detectEfoNelfo(text)
  if (!detected) {
    return {
      ok: false,
      error:
        "Filen ser ikke ut til å være en EFO/NELFO-prisfil. Last opp fila slik du fikk den fra leverandøren, eller bruk Excel/CSV.",
    }
  }

  if (!/^4([.,]\d+)?$/.test(detected.version)) {
    return {
      ok: false,
      error: `Prisfilen er i EFO/NELFO versjon ${detected.version || "ukjent"}, men vi støtter bare versjon 4.0. Be leverandøren eksportere prisfilen i EFO/NELFO 4.0-format.`,
    }
  }

  const lineType = detected.kind === "varefil" ? "VL" : "PL"
  const lines = text.split(/\r\n|\r|\n/)

  let supplierName = ""
  let fromDate: string | null = null
  let toDate: string | null = null

  const rows: EfoParsedRow[] = []
  const stats: EfoStats = {
    productLines: 0,
    imported: 0,
    skippedDiscontinued: 0,
    skippedSurcharge: 0,
    skippedNoPrice: 0,
    skippedInvalid: 0,
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/^\uFEFF/, "")
    if (!line.trim()) continue
    const f = line.split(";")
    const postType = (f[0] ?? "").trim().toUpperCase()

    if (postType === "VH" || postType === "PH") {
      // Hodepost: 11=SFirmaNavn, 7=FraDato, 8=TilDato (1-indeksert i spec)
      supplierName = (f[10] ?? "").trim()
      fromDate = (f[6] ?? "").trim() || null
      toDate = (f[7] ?? "").trim() || null
      continue
    }

    if (postType !== lineType) continue

    stats.productLines++

    // VL/PL-felter (1-indeksert i spec): 2=VareMrk, 3=VareNr, 4=VaBetg,
    // 5=VaBetg2, 7=PrisEnhet, 8=PrisEnhetTxt, 9=Pris (øre), 12=Status,
    // 14=RabattGruppe, 19=Rabatt, 20=Pristype
    if (f.length < 12) {
      stats.skippedInvalid++
      continue
    }

    const vareMrk = (f[1] ?? "").trim()
    if (vareMrk === "9") {
      // Tilleggsvare (frakt/gebyr) – ikke et produkt
      stats.skippedSurcharge++
      continue
    }

    const status = (f[11] ?? "").trim()
    if (status === "3") {
      // Varen utgår fra sortimentet
      stats.skippedDiscontinued++
      continue
    }

    const produkt = [(f[3] ?? "").trim(), (f[4] ?? "").trim()].filter(Boolean).join(" ")
    if (!produkt) {
      stats.skippedInvalid++
      continue
    }

    const pris = parseImplicitDecimal(f[8] ?? "", 2)
    if (pris === null) {
      stats.skippedInvalid++
      continue
    }
    if (pris <= 0) {
      stats.skippedNoPrice++
      continue
    }

    const row: EfoParsedRow = { produkt }

    const enhet = mapUnit((f[6] ?? "").trim(), (f[7] ?? "").trim())
    if (enhet) row.enhet = enhet

    // Pristype: B=bruttopris (listepris), N=nettopris (rabattavtale skal ikke
    // anvendes). Tom regnes som brutto – varefiler er per spec listepriser.
    const pristype = (f[19] ?? "").trim().toUpperCase()
    if (pristype === "N") row.netto_pris = pris
    else row.veil_pris = pris

    const rabatt = f[18]?.trim() ? parseImplicitDecimal(f[18], 2) : null
    if (rabatt !== null && rabatt > 0 && rabatt <= 100) row.rabatt = rabatt

    const varegruppe = (f[13] ?? "").trim()
    if (varegruppe) row.varegruppekode = varegruppe

    const vareNr = (f[2] ?? "").trim()
    if (vareNr) {
      // VareMrk 2 = EAN-kode; 1=elnummer, 4=NRF-nummer og øvrige er
      // leverandørens varenummer.
      if (vareMrk === "2") row.ean = vareNr
      else row.leverandor_id = vareNr
    }

    rows.push(row)
    stats.imported++
  }

  if (stats.productLines === 0) {
    return {
      ok: false,
      error:
        "Fant ingen varelinjer i EFO/NELFO-filen – den ser ut til å være tom eller ufullstendig. Be leverandøren om en ny prisfil.",
    }
  }

  if (stats.imported === 0) {
    return {
      ok: false,
      error: `Fant ${stats.productLines.toLocaleString("no-NO")} varelinjer, men ingen kunne importeres (linjene mangler pris eller produktnavn). Sjekk med leverandøren at prisfilen er komplett.`,
    }
  }

  return {
    ok: true,
    kind: detected.kind,
    supplierName,
    fromDate,
    toDate,
    rows,
    stats,
  }
}

/** Kort norsk oppsummering av linjer som ble hoppet over, for visning i UI. */
export function formatEfoSkipSummary(stats: EfoStats): string | null {
  const parts: string[] = []
  if (stats.skippedDiscontinued > 0)
    parts.push(`${stats.skippedDiscontinued.toLocaleString("no-NO")} utgåtte varer`)
  if (stats.skippedNoPrice > 0)
    parts.push(`${stats.skippedNoPrice.toLocaleString("no-NO")} varer uten pris`)
  if (stats.skippedSurcharge > 0)
    parts.push(`${stats.skippedSurcharge.toLocaleString("no-NO")} frakt-/gebyrlinjer`)
  if (stats.skippedInvalid > 0)
    parts.push(`${stats.skippedInvalid.toLocaleString("no-NO")} ugyldige linjer`)
  if (parts.length === 0) return null
  const joined =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} og ${parts[parts.length - 1]}`
  return `${joined} ble hoppet over.`
}
