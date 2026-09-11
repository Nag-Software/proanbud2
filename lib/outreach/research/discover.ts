// Oppdagelse av nettside.
//
// Bare rundt 15 av 100 firmaer i målgruppen har hjemmeside registrert i
// Brønnøysund. Uten nettside har vi ingenting å personalisere på, så maskinen
// søker etter den selv — men **gjetter aldri**. Et kandidatdomene godtas bare
// når siden vi henter inneholder organisasjonsnummeret, et registrert
// telefonnummer, eller firmanavnet tydelig nok. Ingen verifisering = ingen
// nettside, og prospektet blir `for_tynn` framfor å få en oppdiktet krok.

import { logServerError } from "@/lib/errors/log"
import { companyNameTokens, normalizeForMatch } from "@/lib/outreach/gates"
import { extractPage } from "@/lib/outreach/research/extract"
import { fetchPage } from "@/lib/outreach/research/fetch"

/** Domener som aldri er firmaets egen side, uansett hvor godt de matcher. */
const DIRECTORY_DOMAINS = new Set([
  "proff.no",
  "purehelp.no",
  "gulesider.no",
  "1881.no",
  "brreg.no",
  "forvalt.no",
  "regnskapstall.no",
  "bizweb.no",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "youtube.com",
  "mittanbud.no",
  "byggstart.no",
  "anbudstorget.no",
  "finn.no",
  "indeed.com",
  "nav.no",
  "wikipedia.org",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "google.com",
  "bing.com",
])

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

function isDirectory(host: string): boolean {
  return [...DIRECTORY_DOMAINS].some((bad) => host === bad || host.endsWith(`.${bad}`))
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
}

/** Firmanavn uten selskapsform — «Bygg og Sønner AS» → ["bygg","sønner"]. */
function nameNeedles(companyName: string): string[] {
  return companyNameTokens(companyName).filter((token) => token.length >= 3)
}

async function verifyCandidate(
  candidateUrl: string,
  input: VerifyInput,
): Promise<DiscoveredSite | null> {
  const host = registrableHost(candidateUrl)
  if (!host || isDirectory(host)) return null

  const page = await fetchPage(candidateUrl, 8000)
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
  // firmanavnet står på siden — ikke bare ett vanlig ord som «bygg».
  const needles = nameNeedles(input.companyName)
  if (needles.length > 0 && needles.every((needle) => haystack.includes(needle))) {
    return { url: page.url, host, verified_by: "navn", evidence: needles.join(" ") }
  }

  return null
}

/**
 * Finner og verifiserer firmaets nettside. `knownWebsite` (fra Brreg) prøves
 * først — også den må verifiseres, fordi feltet ofte er utdatert.
 */
export async function discoverWebsite(
  input: VerifyInput & { knownWebsite?: string | null; kommune?: string | null },
): Promise<{ site: DiscoveredSite | null; searched: boolean; query: string | null }> {
  if (input.knownWebsite) {
    const normalized = input.knownWebsite.startsWith("http")
      ? input.knownWebsite
      : `https://${input.knownWebsite}`
    const verified = await verifyCandidate(normalized, input)
    if (verified) return { site: verified, searched: false, query: null }
  }

  const query = [`"${input.companyName}"`, input.kommune || ""].filter(Boolean).join(" ").trim()
  const candidates = await searchBrave(query)

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const host = registrableHost(candidate.url)
    if (!host || seen.has(host) || isDirectory(host)) continue
    seen.add(host)

    const verified = await verifyCandidate(candidate.url, input)
    if (verified) return { site: verified, searched: true, query }
  }

  return { site: null, searched: true, query }
}
