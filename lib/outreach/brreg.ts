// Brønnøysund Enhetsregisteret client for bulk lead import.
// Public API, no key required. Returns email/phone when the company has
// registered them; website scraping fills the gaps (lib/outreach/enrich.ts).
// Næringskoder er SN2025 (se lib/outreach/segments.ts).

import { domainFromWebsite, emailDomainOf, FREEMAIL_DOMAINS } from "@/lib/outreach/gates"
import { resolveTrade } from "@/lib/outreach/segments"

const BRREG_BASE = "https://data.brreg.no/enhetsregisteret/api/enheter"

export type BrregEnhet = {
  organisasjonsnummer: string
  navn: string
  organisasjonsform?: { kode?: string }
  naeringskode1?: { kode?: string; beskrivelse?: string }
  antallAnsatte?: number
  stiftelsesdato?: string
  registrertIMvaregisteret?: boolean
  erIKonsern?: boolean
  hjemmeside?: string
  // Brønnøysund DOES return these contact fields (when registered).
  epostadresse?: string
  telefon?: string
  mobil?: string
  konkurs?: boolean
  underAvvikling?: boolean
  underTvangsavviklingEllerTvangsopplosning?: boolean
  forretningsadresse?: {
    adresse?: string[]
    postnummer?: string
    poststed?: string
    kommune?: string
    kommunenummer?: string
    landkode?: string
  }
}

export type BrregSearchParams = {
  /** NACE prefixes, e.g. ["41","42","43"] for construction. Matched by prefix. */
  naeringskoder: string[]
  /** Fritekst navnesøk (Brreg-parameteren `navn`) — brukes av selgerens søke-UI. */
  navn?: string
  kommunenummer?: string
  fraAntallAnsatte?: number
  tilAntallAnsatte?: number
  /** Organisasjonsform, f.eks. "AS". ENK/NUF kan aldri få kald e-post. */
  organisasjonsform?: string
  /** true = kun mva-registrerte (driver faktisk). */
  registrertIMvaregisteret?: boolean
  /** Filtrer bort konkurs/avvikling allerede i søket, så sidene fylles med levende firmaer. */
  kunAktive?: boolean
  page?: number
  size?: number
  /** Brreg sort expression, e.g. "navn,asc" or "organisasjonsnummer,desc".
   *  Rotating the sort opens a different reachable slice of the registry (Brreg
   *  caps deep paging at size*(page+1) <= 10_000), so repeated imports surface
   *  fresh companies instead of re-scanning the same alphabetical head. */
  sort?: string
}

export type BrregPage = {
  enheter: BrregEnhet[]
  page: number
  totalPages: number
  totalElements: number
}

export async function searchBrregEnheter(params: BrregSearchParams): Promise<BrregPage> {
  const search = new URLSearchParams()
  for (const code of params.naeringskoder) {
    if (code.trim()) search.append("naeringskode", code.trim())
  }
  if (params.navn?.trim()) search.set("navn", params.navn.trim())
  if (params.kommunenummer?.trim()) search.set("kommunenummer", params.kommunenummer.trim())
  if (typeof params.fraAntallAnsatte === "number") {
    search.set("fraAntallAnsatte", String(params.fraAntallAnsatte))
  }
  if (typeof params.tilAntallAnsatte === "number") {
    search.set("tilAntallAnsatte", String(params.tilAntallAnsatte))
  }
  if (params.organisasjonsform?.trim()) search.set("organisasjonsform", params.organisasjonsform.trim())
  if (typeof params.registrertIMvaregisteret === "boolean") {
    search.set("registrertIMvaregisteret", String(params.registrertIMvaregisteret))
  }
  if (params.kunAktive) {
    search.set("konkurs", "false")
    search.set("underAvvikling", "false")
  }
  search.set("size", String(Math.min(Math.max(params.size ?? 100, 1), 100)))
  search.set("page", String(Math.max(params.page ?? 0, 0)))
  if (params.sort?.trim()) search.set("sort", params.sort.trim())

  const res = await fetch(`${BRREG_BASE}?${search.toString()}`, {
    headers: { Accept: "application/json" },
    // Always fetch fresh — this is an admin-triggered import.
    cache: "no-store",
  })

  if (!res.ok) {
    let detail = ""
    try {
      const body = (await res.json()) as {
        feilmelding?: string
        valideringsfeil?: Array<{ feilmelding?: string }>
      }
      detail = body?.valideringsfeil?.[0]?.feilmelding || body?.feilmelding || ""
    } catch {
      // ignore — no parseable error body
    }
    throw new Error(`Brønnøysund-søk feilet (${res.status})${detail ? `: ${detail}` : ""}`)
  }

  const data = (await res.json()) as {
    _embedded?: { enheter?: BrregEnhet[] }
    page?: { number?: number; totalPages?: number; totalElements?: number }
  }

  return {
    enheter: data._embedded?.enheter ?? [],
    page: data.page?.number ?? params.page ?? 0,
    totalPages: data.page?.totalPages ?? 0,
    totalElements: data.page?.totalElements ?? 0,
  }
}

export type MappedProspect = {
  org_number: string
  name: string
  nace_code: string | null
  nace_description: string | null
  employee_count: number | null
  website: string | null
  email: string | null
  phone: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  kommune: string | null
  kommune_number: string | null
  source: "brreg"
  enrichment_status: "pending" | "enriched" | "no_contact"
  org_form: string | null
  founded_on: string | null
  vat_registered: boolean | null
  in_group: boolean | null
  domain: string | null
  trade: string
  email_source: "brreg" | null
}

/** Convert a Brreg entity to a prospect insert row. Returns null for entities
 *  that should be skipped (bankrupt / under liquidation). */
export function mapEnhetToProspect(enhet: BrregEnhet): MappedProspect | null {
  if (enhet.konkurs || enhet.underAvvikling || enhet.underTvangsavviklingEllerTvangsopplosning) {
    return null
  }
  if (!enhet.organisasjonsnummer || !enhet.navn) return null

  const addr = enhet.forretningsadresse
  const website = enhet.hjemmeside?.trim() || null
  const email = enhet.epostadresse?.trim().toLowerCase() || null
  const phone = enhet.telefon?.trim() || enhet.mobil?.trim() || null

  // Contact straight from Brreg → enriched. Otherwise a website means the scrape
  // step can still try; no website and no contact → call list only.
  const enrichment_status = email || phone ? "enriched" : website ? "pending" : "no_contact"
  const validEmail = email && email.includes("@") ? email : null
  const emailDomain = validEmail ? emailDomainOf(validEmail) : null

  return {
    org_number: enhet.organisasjonsnummer,
    name: enhet.navn,
    nace_code: enhet.naeringskode1?.kode ?? null,
    nace_description: enhet.naeringskode1?.beskrivelse ?? null,
    employee_count: typeof enhet.antallAnsatte === "number" ? enhet.antallAnsatte : null,
    website: website ? (website.startsWith("http") ? website : `https://${website}`) : null,
    email: validEmail,
    phone,
    address: addr?.adresse?.filter(Boolean).join(", ") || null,
    postal_code: addr?.postnummer ?? null,
    city: addr?.poststed ?? null,
    kommune: addr?.kommune ?? null,
    kommune_number: addr?.kommunenummer ?? null,
    source: "brreg",
    enrichment_status,
    org_form: enhet.organisasjonsform?.kode?.trim().toUpperCase() || null,
    founded_on: /^\d{4}-\d{2}-\d{2}$/.test(enhet.stiftelsesdato ?? "") ? enhet.stiftelsesdato! : null,
    vat_registered: typeof enhet.registrertIMvaregisteret === "boolean" ? enhet.registrertIMvaregisteret : null,
    in_group: typeof enhet.erIKonsern === "boolean" ? enhet.erIKonsern : null,
    // Nettsidens domene er sikrest; ellers e-postdomenet, men aldri gmail o.l.
    domain: domainFromWebsite(website) ?? (emailDomain && !FREEMAIL_DOMAINS.has(emailDomain) ? emailDomain : null),
    trade: resolveTrade({
      naceCode: enhet.naeringskode1?.kode,
      naceDescription: enhet.naeringskode1?.beskrivelse,
    }),
    email_source: validEmail ? "brreg" : null,
  }
}

/** Én enhet fra Brønnøysund, eller null hvis den ikke finnes / oppslaget feiler. */
export async function fetchBrregEnhet(orgNumber: string): Promise<BrregEnhet | null> {
  const orgnr = orgNumber.replace(/\s/g, "")
  if (!/^\d{9}$/.test(orgnr)) return null
  try {
    const res = await fetch(`${BRREG_BASE}/${orgnr}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    return (await res.json()) as BrregEnhet
  } catch {
    return null
  }
}

type BrregRolleResponse = {
  rollegrupper?: Array<{
    type?: { kode?: string }
    roller?: Array<{
      type?: { kode?: string }
      avregistrert?: boolean
      person?: { navn?: { fornavn?: string; mellomnavn?: string; etternavn?: string }; erDoed?: boolean }
      enhet?: { organisasjonsnummer?: string; navn?: string[] }
    }>
  }>
}

export type BrregRoller = {
  /** Navn på personer med roller i firmaet (daglig leder, innehaver, styre,
   *  kontaktperson). Brukes KUN til å kjenne igjen personlige e-postadresser og
   *  i ringebrief — aldri i e-posttekst, og fødselsdato hentes ikke. */
  personNames: string[]
  dagligLeder: string | null
  /** Regnskapsfører (rollen REGN) — grunnlaget for partnersegmentet. */
  regnskapsforerOrgnr: string | null
}

const PERSON_ROLE_CODES = new Set(["DAGL", "INNH", "LEDE", "NEST", "MEDL", "KONT", "DTPR", "DTSO", "KOMP"])

/** Rollene til en enhet. Tom struktur (ikke null) når oppslaget feiler, så
 *  kallere kan behandle «ingen roller» og «feil» likt. */
export async function fetchBrregRoller(orgNumber: string): Promise<BrregRoller> {
  const empty: BrregRoller = { personNames: [], dagligLeder: null, regnskapsforerOrgnr: null }
  const orgnr = orgNumber.replace(/\s/g, "")
  if (!/^\d{9}$/.test(orgnr)) return empty
  try {
    const res = await fetch(`${BRREG_BASE}/${orgnr}/roller`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return empty
    const data = (await res.json()) as BrregRolleResponse
    const names = new Set<string>()
    let dagligLeder: string | null = null
    let regnskapsforerOrgnr: string | null = null
    for (const gruppe of data.rollegrupper ?? []) {
      for (const rolle of gruppe.roller ?? []) {
        if (rolle.avregistrert) continue
        const code = rolle.type?.kode ?? ""
        if (code === "REGN" && rolle.enhet?.organisasjonsnummer) {
          regnskapsforerOrgnr = rolle.enhet.organisasjonsnummer
        }
        const navn = rolle.person?.navn
        if (!navn || rolle.person?.erDoed || !PERSON_ROLE_CODES.has(code)) continue
        const full = [navn.fornavn, navn.mellomnavn, navn.etternavn].filter(Boolean).join(" ").trim()
        if (!full) continue
        names.add(full)
        if (code === "DAGL" || (code === "INNH" && !dagligLeder)) dagligLeder = full
      }
    }
    return { personNames: [...names], dagligLeder, regnskapsforerOrgnr }
  } catch {
    return empty
  }
}
