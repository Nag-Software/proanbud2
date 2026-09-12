// Regnskapsregisteret (data.brreg.no).
//
// Tallene brukes til KVALIFISERING — aldri i e-postteksten. Å skrive «jeg ser
// dere omsatte for 14,2 millioner i fjor» til en fremmed er ubehagelig, selv om
// det er offentlig. Internt sier det derimot mye: et firma med 8 ansatte og
// voksende driftsinntekter har som regel rot i papirflyten.
//
// API-et er beskrevet som «midlertidig» og er ikke vedlikeholdt. Derfor gir
// enhver feil `null`, og null blokkerer aldri noe.

import { fetchJson } from "@/lib/outreach/research/fetch"

const BASE = "https://data.brreg.no/regnskapsregisteret/api/regnskap"

type RegnskapRow = {
  regnskapsperiode?: { fraDato?: string; tilDato?: string }
  regnskap?: {
    resultatregnskapResultat?: {
      driftsresultat?: {
        driftsinntekter?: { sumDriftsinntekter?: number }
        driftskostnad?: { sumDriftskostnad?: number }
        driftsresultat?: number
      }
      aarsresultat?: number
    }
  }
  egenkapitalGjeld?: { sumEgenkapitalGjeld?: number }
}

export type RegnskapAar = {
  aar: number
  driftsinntekter: number | null
  driftsresultat: number | null
  aarsresultat: number | null
}

export type Regnskap = {
  siste: RegnskapAar | null
  forrige: RegnskapAar | null
  /** Vekst i driftsinntekter siste år, som andel (0.18 = +18 %). */
  vekst: number | null
  source_url: string
}

function yearOf(row: RegnskapRow): number | null {
  const til = row.regnskapsperiode?.tilDato
  if (!til) return null
  const year = Number(til.slice(0, 4))
  return Number.isFinite(year) ? year : null
}

function toAar(row: RegnskapRow): RegnskapAar | null {
  const aar = yearOf(row)
  if (aar === null) return null
  const drift = row.regnskap?.resultatregnskapResultat?.driftsresultat
  return {
    aar,
    driftsinntekter: drift?.driftsinntekter?.sumDriftsinntekter ?? null,
    driftsresultat: drift?.driftsresultat ?? null,
    aarsresultat: row.regnskap?.resultatregnskapResultat?.aarsresultat ?? null,
  }
}

export async function fetchRegnskap(orgNumber: string): Promise<Regnskap | null> {
  const digits = (orgNumber || "").replace(/\D/g, "")
  if (digits.length !== 9) return null

  const url = `${BASE}/${digits}`
  const rows = await fetchJson<RegnskapRow[]>(url, 8000)
  if (!Array.isArray(rows) || rows.length === 0) return null

  const years = rows
    .map(toAar)
    .filter((row): row is RegnskapAar => row !== null)
    .sort((a, b) => b.aar - a.aar)

  if (years.length === 0) return null

  const siste = years[0]
  const forrige = years[1] ?? null
  const vekst =
    siste.driftsinntekter && forrige?.driftsinntekter && forrige.driftsinntekter > 0
      ? (siste.driftsinntekter - forrige.driftsinntekter) / forrige.driftsinntekter
      : null

  return { siste, forrige, vekst, source_url: url }
}

/** Omsetning per ansatt sier mer om modenhet enn omsetningen alene. */
export function omsetningPerAnsatt(
  regnskap: Regnskap | null,
  employeeCount: number | null | undefined,
): number | null {
  const inntekter = regnskap?.siste?.driftsinntekter
  if (!inntekter || !employeeCount || employeeCount <= 0) return null
  return Math.round(inntekter / employeeCount)
}
