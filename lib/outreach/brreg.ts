// Brønnøysund Enhetsregisteret client for bulk lead import.
// Public API, no key required. Note: this API does NOT return email/phone —
// those must be enriched separately (see lib/outreach/enrich.ts).

const BRREG_BASE = "https://data.brreg.no/enhetsregisteret/api/enheter"

export type BrregEnhet = {
  organisasjonsnummer: string
  navn: string
  organisasjonsform?: { kode?: string }
  naeringskode1?: { kode?: string; beskrivelse?: string }
  antallAnsatte?: number
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
  kommunenummer?: string
  fraAntallAnsatte?: number
  tilAntallAnsatte?: number
  page?: number
  size?: number
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
  if (params.kommunenummer?.trim()) search.set("kommunenummer", params.kommunenummer.trim())
  if (typeof params.fraAntallAnsatte === "number") {
    search.set("fraAntallAnsatte", String(params.fraAntallAnsatte))
  }
  if (typeof params.tilAntallAnsatte === "number") {
    search.set("tilAntallAnsatte", String(params.tilAntallAnsatte))
  }
  search.set("size", String(Math.min(Math.max(params.size ?? 100, 1), 100)))
  search.set("page", String(Math.max(params.page ?? 0, 0)))

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

  return {
    org_number: enhet.organisasjonsnummer,
    name: enhet.navn,
    nace_code: enhet.naeringskode1?.kode ?? null,
    nace_description: enhet.naeringskode1?.beskrivelse ?? null,
    employee_count: typeof enhet.antallAnsatte === "number" ? enhet.antallAnsatte : null,
    website: website ? (website.startsWith("http") ? website : `https://${website}`) : null,
    email: email && email.includes("@") ? email : null,
    phone,
    address: addr?.adresse?.filter(Boolean).join(", ") || null,
    postal_code: addr?.postnummer ?? null,
    city: addr?.poststed ?? null,
    kommune: addr?.kommune ?? null,
    kommune_number: addr?.kommunenummer ?? null,
    source: "brreg",
    enrichment_status,
  }
}
