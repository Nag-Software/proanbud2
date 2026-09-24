import type { BrregEnhet } from "@/lib/outreach/brreg"
import { resolveTrade, type TradeKey } from "@/lib/outreach/segments"

const BRREG_ENHET_URL = "https://data.brreg.no/enhetsregisteret/api/enheter"

/** Feltene i bedriftsprofilen som Brønnøysund allerede vet. */
export type BrregCompanyProfile = {
  address: string | null
  postalCode: string | null
  city: string | null
  vatRegistered: boolean | null
  /** Verdi i COMPANY_INDUSTRY_OPTIONS, eller null når faget ikke har en tydelig match. */
  industry: string | null
}

const INDUSTRY_BY_TRADE: Partial<Record<TradeKey, string>> = {
  bygg: "tomrer",
  snekker: "tomrer",
  elektro: "elektriker",
  ror: "rorlegger",
  maler: "maler",
}

export function isOrgNumber(value: string | null | undefined): value is string {
  return /^\d{9}$/.test((value ?? "").replace(/\s/g, ""))
}

export function mapBrregEnhetToProfile(enhet: BrregEnhet): BrregCompanyProfile {
  const address = enhet.forretningsadresse
  const street = (address?.adresse ?? []).map((line) => line.trim()).filter(Boolean).join(", ")
  const trade = enhet.naeringskode1
    ? resolveTrade({ naceCode: enhet.naeringskode1.kode, naceDescription: enhet.naeringskode1.beskrivelse })
    : null
  return {
    address: street || null,
    postalCode: address?.postnummer?.trim() || null,
    city: address?.poststed ? toTitleCase(address.poststed) : null,
    vatRegistered: typeof enhet.registrertIMvaregisteret === "boolean" ? enhet.registrertIMvaregisteret : null,
    industry: trade ? INDUSTRY_BY_TRADE[trade] ?? null : null,
  }
}

/** «OSLO» → «Oslo», «MO I RANA» → «Mo i Rana». Brreg lagrer poststed i versaler. */
function toTitleCase(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((part, index) => (index > 0 && /^(i|på|og)$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("")
}

/**
 * Slår opp en bedrift i Enhetsregisteret. Beste innsats: feiler oppslaget (nettverk,
 * ukjent org.nr.), returneres null og opprettelsen går videre uten.
 */
export async function fetchBrregCompanyProfile(orgNumber: string): Promise<BrregCompanyProfile | null> {
  if (!isOrgNumber(orgNumber)) return null
  try {
    const response = await fetch(`${BRREG_ENHET_URL}/${orgNumber.replace(/\s/g, "")}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4000),
    })
    if (!response.ok) return null
    return mapBrregEnhetToProfile((await response.json()) as BrregEnhet)
  } catch {
    return null
  }
}
