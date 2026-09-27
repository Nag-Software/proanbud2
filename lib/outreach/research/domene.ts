// Hvor ligger nettsiden? Kandidater uten søkemotor.
//
// Bare rundt 15 av 100 firmaer i målgruppen har nettside i Brønnøysund. Før
// dette var eneste vei videre et betalt søk (Brave). Men de fleste som har
// e-post, har den på sitt eget domene — post@firma.no bor på firma.no — og
// mange av resten heter det samme som firmaet. Begge deler er gratis å prøve.
//
// Rene funksjoner uten nettverk, så de kan testes. Selve prøvingen — og
// verifiseringen mot org.nr., telefon eller navn — skjer i discover.ts.

import {
  companyNameTokens,
  emailDomainOf,
  FREEMAIL_DOMAINS,
  isDirectoryDomain,
  LEGAL_SUFFIX_TOKENS,
  normalizeForMatch,
} from "@/lib/outreach/gates"

/**
 * post@firma.no → firma.no. Aldri Gmail, Online, Altibox o.l. (der bor
 * tusenvis av firmaer), og aldri en katalog.
 */
export function emailDomainCandidate(email: string | null | undefined): string | null {
  if (!email) return null
  const domain = emailDomainOf(email)?.replace(/^(mail|epost|post)\./, "")
  if (!domain || !domain.includes(".")) return null
  if (FREEMAIL_DOMAINS.has(domain) || isDirectoryDomain(domain)) return null
  return domain
}

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/**
 * Domener som er verdt å prøve for et firmanavn, mest sannsynlig først.
 * «Holmestrand Bygg og Tak AS» → holmestrandbyggogtak.no, holmestrandbyggtak.no,
 * holmestrand-bygg-og-tak.no, …
 *
 * Et gjettet domene kan like gjerne tilhøre noen andre, eller være parkert med
 * firmanavnet på siden. Derfor godtas et gjett bare når org.nr. eller telefon
 * står der — aldri på navnet alene (se discover.ts).
 */
export function guessDomains(companyName: string, max = 5): string[] {
  const words = companyName
    .split(/[\s&.,/()\-–+]+/)
    .map(normalizeForMatch)
    .filter(Boolean)
  // Bare selskapsformen på slutten fjernes. «Ås» blir «as» når æøå skrives om,
  // og et stedsnavn midt i navnet er en del av domenet, ikke «AS».
  const withoutSuffix =
    words.length > 1 && LEGAL_SUFFIX_TOKENS.has(words[words.length - 1]) ? words.slice(0, -1) : words
  if (withoutSuffix.length === 1 && LEGAL_SUFFIX_TOKENS.has(withoutSuffix[0])) return []
  const core = companyNameTokens(companyName)
  if (withoutSuffix.length === 0 || core.length === 0) return []

  const labels = [
    withoutSuffix.join(""),
    core.join(""),
    withoutSuffix.join("-"),
    core.join("-"),
    `${withoutSuffix.join("")}as`,
    core.length > 2 ? core.slice(0, 2).join("") : null,
  ]

  const seen = new Set<string>()
  const domains: string[] = []
  for (const label of labels) {
    if (!label || label.length < 3 || !LABEL.test(label) || seen.has(label)) continue
    seen.add(label)
    const domain = `${label}.no`
    if (isDirectoryDomain(domain)) continue
    domains.push(domain)
    if (domains.length >= max) break
  }
  return domains
}
