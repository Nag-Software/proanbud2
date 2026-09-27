// Oppdagelse av nettside.
//
// Bare rundt 15 av 100 firmaer i målgruppen har hjemmeside registrert i
// Brønnøysund. Uten nettside har vi ingenting å personalisere på, så maskinen
// leter selv — gratis kilder først (e-postdomenet, domener fra firmanavnet),
// og søk bare hvis det er satt opp. Men den **stoler aldri på en kandidat
// uten bevis**: siden vi henter må inneholde organisasjonsnummeret, et
// registrert telefonnummer, eller (for kilder vi vet er deres) firmanavnet
// tydelig nok. Ingen verifisering = ingen nettside, og prospektet blir
// `for_tynn` framfor å få en oppdiktet krok.

import { logServerError } from "@/lib/errors/log"
import { companyNameTokens, isDirectoryDomain, normalizeForMatch } from "@/lib/outreach/gates"
import { emailDomainCandidate, guessDomains } from "@/lib/outreach/research/domene"
import { extractPage } from "@/lib/outreach/research/extract"
import { fetchPage } from "@/lib/outreach/research/fetch"

export type DiscoveryCandidate = {
  url: string
  title: string
  snippet: string
}

function registrableHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "")
  } catch {
    return null
  }
}


/** Søk er valgfritt: uten BRAVE_SEARCH_API_KEY gir den null, og oppdagelsen
 *  klarer seg med Brønnøysund, e-postdomenet og navnet. */
function braveEnabled(): boolean {
  return Boolean(process.env.BRAVE_SEARCH_API_KEY?.trim())
}

async function searchBrave(query: string): Promise<DiscoveryCandidate[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim()
  if (!apiKey) return []

  const url = new URL("https://api.search.brave.com/res/v1/web/search")
  url.searchParams.set("q", query)
  url.searchParams.set("count", "8")
  url.searchParams.set("country", "NO")
  url.searchParams.set("search_lang", "no")

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) return []

    const payload = (await response.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
    }
    return (payload.web?.results ?? [])
      .map((hit) => ({
        url: (hit.url || "").trim(),
        title: (hit.title || "").trim(),
        snippet: (hit.description || "").replace(/<[^>]+>/g, "").trim(),
      }))
      .filter((hit) => hit.url)
  } catch (error) {
    void logServerError({
      message: "Brave-søk for nettsideoppdagelse feilet",
      level: "warning",
      source: "worker",
      error,
      context: { query },
    })
    return []
  }
}

export type VerifyInput = {
  companyName: string
  orgNumber: string
  /** Telefonnummer fra Brreg, hvis vi har det. Bare sifrene brukes. */
  phone?: string | null
}

export type DiscoveredSite = {
  url: string
  host: string
  /** Hva som gjorde at vi stolte på treffet. */
  verified_by: "orgnr" | "telefon" | "navn"
  evidence: string
  /** Hvor kandidaten kom fra. */
  found_by?: "brreg" | "epost" | "navn" | "sok"
}

/** Firmanavn uten selskapsform — «Bygg og Sønner AS» → ["bygg","sønner"]. */
function nameNeedles(companyName: string): string[] {
  return companyNameTokens(companyName).filter((token) => token.length >= 3)
}

async function verifyCandidate(
  candidateUrl: string,
  input: VerifyInput,
  options: { allowName?: boolean; timeoutMs?: number } = {},
): Promise<DiscoveredSite | null> {
  const host = registrableHost(candidateUrl)
  if (!host || isDirectoryDomain(host)) return null

  const page = await fetchPage(candidateUrl, options.timeoutMs ?? 8000)
  if (!page) return null

  const extracted = extractPage(page.html, page.url)
  const haystack = normalizeForMatch(`${extracted.title} ${extracted.text}`)
  const digits = page.html.replace(/\D/g, "")

  if (input.orgNumber && digits.includes(input.orgNumber.replace(/\D/g, ""))) {
    return { url: page.url, host, verified_by: "orgnr", evidence: input.orgNumber }
  }

  const phoneDigits = (input.phone || "").replace(/\D/g, "").replace(/^47/, "")
  if (phoneDigits.length === 8 && extracted.phones.includes(phoneDigits)) {
    return { url: page.url, host, verified_by: "telefon", evidence: phoneDigits }
  }

  // Navnetreff er svakest, så det kreves at alle de meningsbærende delene av
  // firmanavnet står på siden — ikke bare ett vanlig ord som «bygg». Og aldri
  // for et gjettet domene: et parkert domene viser ofte nettopp navnet.
  const needles = nameNeedles(input.companyName)
  if (options.allowName !== false && needles.length > 0 && needles.every((needle) => haystack.includes(needle))) {
    return { url: page.url, host, verified_by: "navn", evidence: needles.join(" ") }
  }

  return null
}

/** Prøver domenet, og www. hvis domenet selv ikke svarer. */
async function verifyDomain(
  domain: string,
  input: VerifyInput,
  options: { allowName: boolean; timeoutMs: number },
): Promise<DiscoveredSite | null> {
  return (
    (await verifyCandidate(`https://${domain}`, input, options)) ??
    (await verifyCandidate(`https://www.${domain}`, input, options))
  )
}

/**
 * Finner og verifiserer firmaets nettside, gratis kilder først:
 *
 *   1. Nettsiden i Brønnøysund — også den må verifiseres, feltet er ofte utdatert
 *   2. Domenet i e-postadressen (post@firma.no → firma.no)
 *   3. Domener gjettet fra firmanavnet — godtas bare på org.nr. eller telefon
 *   4. Søk (Brave), bare hvis nøkkelen finnes
 *
 * Ingen kandidat godtas uten at siden selv beviser at den er firmaets.
 */
export async function discoverWebsite(
  input: VerifyInput & { knownWebsite?: string | null; kommune?: string | null; email?: string | null },
): Promise<{ site: DiscoveredSite | null; searched: boolean; query: string | null }> {
  if (input.knownWebsite) {
    const normalized = input.knownWebsite.startsWith("http")
      ? input.knownWebsite
      : `https://${input.knownWebsite}`
    const verified = await verifyCandidate(normalized, input)
    if (verified) return { site: { ...verified, found_by: "brreg" }, searched: false, query: null }
  }

  const tried = new Set<string>()
  const knownHost = input.knownWebsite ? registrableHost(
    input.knownWebsite.startsWith("http") ? input.knownWebsite : `https://${input.knownWebsite}`,
  ) : null
  if (knownHost) tried.add(knownHost)

  const fromEmail = emailDomainCandidate(input.email)
  if (fromEmail && !tried.has(fromEmail)) {
    tried.add(fromEmail)
    const verified = await verifyDomain(fromEmail, input, { allowName: true, timeoutMs: 8000 })
    if (verified) return { site: { ...verified, found_by: "epost" }, searched: false, query: null }
  }

  // Gjettene prøves samtidig, med kortere tidsavbrudd — de fleste finnes ikke,
  // og en som henger skal ikke holde research igjen. Første i prioritert
  // rekkefølge vinner.
  const guesses = guessDomains(input.companyName).filter((domain) => !tried.has(domain))
  if (guesses.length > 0) {
    const results = await Promise.all(
      guesses.map((domain) => verifyDomain(domain, input, { allowName: false, timeoutMs: 5000 })),
    )
    const verified = results.find((result): result is DiscoveredSite => Boolean(result))
    if (verified) return { site: { ...verified, found_by: "navn" }, searched: false, query: null }
    for (const domain of guesses) tried.add(domain)
  }

  if (!braveEnabled()) return { site: null, searched: false, query: null }

  const query = [`"${input.companyName}"`, input.kommune || ""].filter(Boolean).join(" ").trim()
  const candidates = await searchBrave(query)

  for (const candidate of candidates) {
    const host = registrableHost(candidate.url)
    if (!host || tried.has(host) || isDirectoryDomain(host)) continue
    tried.add(host)

    const verified = await verifyCandidate(candidate.url, input)
    if (verified) return { site: { ...verified, found_by: "sok" }, searched: true, query }
  }

  return { site: null, searched: true, query }
}
