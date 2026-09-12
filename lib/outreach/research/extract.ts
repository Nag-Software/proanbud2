// HTML → ren tekst, valg av undersider, og deterministiske signaldetektorer.
//
// Signalene avgjøres her, i kode, ikke av modellen. Modellen får bare trekke ut
// og formulere. Da kan ikke en hallusinasjon flytte et prospekt fra C til A.

export type ExtractedPage = {
  url: string
  title: string
  /** Ren tekst, normalisert whitespace. Dette er fasiten sitater valideres mot. */
  text: string
  /** Interne lenker funnet på siden, absolutte og avduplisert. */
  links: string[]
  emails: string[]
  phones: string[]
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const NO_PHONE_RE = /(?:\+?47[\s]?)?(?:\d[\s]?){8}/g

const BLOCK_TAGS =
  /<\/?(?:p|div|section|article|header|footer|main|aside|nav|h[1-6]|li|tr|br|hr|table|ul|ol|dl|dd|dt|form|figure|blockquote)\b[^>]*>/gi

/** Fjerner skript, stil og annet som aldri er lesbar tekst. */
function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    aring: "å",
    Aring: "Å",
    oslash: "ø",
    Oslash: "Ø",
    aelig: "æ",
    AElig: "Æ",
    laquo: "«",
    raquo: "»",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    middot: "·",
    shy: "",
  }
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => (name in named ? named[name] : match))
}

export function htmlToText(html: string): string {
  const withBreaks = stripNoise(html).replace(BLOCK_TAGS, "\n")
  const withoutTags = withBreaks.replace(/<[^>]+>/g, " ")
  return decodeEntities(withoutTags)
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match) return ""
  return decodeEntities(match[1].replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function sameSite(a: URL, b: URL): boolean {
  const strip = (host: string) => host.toLowerCase().replace(/^www\./, "")
  return strip(a.hostname) === strip(b.hostname)
}

function extractLinks(html: string, baseUrl: string): string[] {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }

  const seen = new Set<string>()
  const out: string[] = []
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["']/gi)) {
    const raw = match[1].trim()
    if (!raw || raw.startsWith("#") || /^(mailto|tel|javascript):/i.test(raw)) continue
    let resolved: URL
    try {
      resolved = new URL(raw, base)
    } catch {
      continue
    }
    if (!["http:", "https:"].includes(resolved.protocol) || !sameSite(resolved, base)) continue
    resolved.hash = ""
    const key = resolved.toString()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

function extractEmails(html: string, text: string): string[] {
  const found = new Set<string>()
  for (const match of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    found.add(decodeURIComponent(match[1]).toLowerCase())
  }
  for (const match of text.matchAll(EMAIL_RE)) found.add(match[0].toLowerCase())
  return [...found].filter((email) => !/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(email))
}

function extractPhones(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(NO_PHONE_RE)) {
    const digits = match[0].replace(/\D/g, "").replace(/^47/, "")
    if (digits.length === 8 && /^[2-9]/.test(digits)) found.add(digits)
  }
  return [...found]
}

export function extractPage(html: string, url: string): ExtractedPage {
  const text = htmlToText(html)
  return {
    url,
    title: extractTitle(html),
    text,
    links: extractLinks(html, url),
    emails: extractEmails(html, text),
    phones: extractPhones(text),
  }
}

/** Undersider vi vil ha, i prioritert rekkefølge. Ett treff per kategori. */
const SUBPAGE_RULES: Array<{ key: string; pattern: RegExp }> = [
  { key: "tjenester", pattern: /(tjenest|hva-vi-gjor|hva_vi_gjor|vare-tjenester|services|fagomr)/i },
  { key: "om", pattern: /(om-oss|om_oss|\/om\/|\/om$|about|historie)/i },
  { key: "referanser", pattern: /(referanse|prosjekt|portefolje|portfolio|galleri|case)/i },
  { key: "kontakt", pattern: /(kontakt|contact)/i },
  { key: "jobb", pattern: /(jobb|karriere|ledig|stilling|vacan|career)/i },
]

const SUBPAGE_SKIP =
  /(personvern|cookie|informasjonskapsl|vilkar|vilkår|terms|privacy|\/tag\/|\/category\/|\/wp-|\.pdf($|\?)|\.jpg|\.png|\/feed|\/handlekurv|\/cart|\/checkout|\/logg-inn|\/login)/i

/**
 * Velger opptil `limit` undersider fra forsidens lenker — én per kategori, i
 * prioritert rekkefølge, slik at vi alltid får bredde framfor fem varianter av
 * samme tjenesteside.
 */
export function pickSubpages(links: string[], frontUrl: string, limit = 5): string[] {
  const picked: string[] = []
  const taken = new Set<string>()
  const candidates = links.filter((link) => link !== frontUrl && !SUBPAGE_SKIP.test(link))

  for (const rule of SUBPAGE_RULES) {
    if (picked.length >= limit) break
    const hit = candidates.find((link) => !taken.has(link) && rule.pattern.test(link))
    if (hit) {
      taken.add(hit)
      picked.push(hit)
    }
  }

  // Fyll opp med de korteste stiene som er igjen — de er som regel toppnivå.
  if (picked.length < limit) {
    const rest = candidates
      .filter((link) => !taken.has(link))
      .sort((a, b) => a.length - b.length)
    for (const link of rest) {
      if (picked.length >= limit) break
      taken.add(link)
      picked.push(link)
    }
  }

  return picked
}

// ── Deterministiske signaldetektorer ────────────────────────────────────────
//
// Hvert signal har et ordrett belegg fra sideteksten, slik at Casper kan se
// nøyaktig hva maskinen reagerte på.

export type Signal = {
  key: SignalKey
  met: boolean
  /** Ordrett utdrag fra siden. Tom når met = false. */
  evidence: string
  source_url: string | null
}

export const SIGNAL_KEYS = [
  "tilbudsskjema",
  "referanseprosjekter",
  "regnskapsverktoy",
  "rekruttering",
  "flerspraklig",
  "sentral_godkjenning",
  "flere_fag",
  "privatmarked",
] as const
export type SignalKey = (typeof SIGNAL_KEYS)[number]

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  tilbudsskjema: "Tilbudsskjema på nettsiden",
  referanseprosjekter: "Referanseprosjekter",
  regnskapsverktoy: "Tripletex/Fiken i bruk",
  rekruttering: "Rekrutterer nå",
  flerspraklig: "Utenlandsk arbeidskraft",
  sentral_godkjenning: "Sentral godkjenning",
  flere_fag: "Flere fag / totalentreprise",
  privatmarked: "Privatmarked",
}

const SIGNAL_RULES: Record<SignalKey, RegExp> = {
  tilbudsskjema:
    /\b(be om (et )?(uforpliktende )?tilbud|få (et )?tilbud|innhent tilbud|pristilbud|befaring|gratis befaring|send (oss )?en foresp)/i,
  referanseprosjekter: /\b(referanseprosjekt|våre prosjekter|utførte prosjekter|se prosjekt|referanser fra)/i,
  regnskapsverktoy: /\b(tripletex|fiken|poweroffice|visma eaccounting|24sevenoffice|unimicro)\b/i,
  rekruttering:
    /\b(ledig stilling|ledige stillinger|vi søker|vi ansetter|bli med (på|i) laget|jobbe hos oss|lærling)/i,
  flerspraklig: /\b(po polsku|zapraszamy|firma budowlana|vi snakker polsk|polsktalende|litauisk)\b/i,
  sentral_godkjenning: /\b(sentral godkjenning|sentralt godkjent|godkjent foretak|tiltaksklasse)\b/i,
  flere_fag:
    /\b(totalentrepren|alt innen|komplett(e)? (tjenester|løsninger)|fra a til å|flere fagområder|tømrer og mur)/i,
  privatmarked: /\b(privatkunder|for deg som privatperson|boligeier|husholdning|oppussing av (bolig|hjem)|enebolig)\b/i,
}

/** Henter setningen rundt treffet, så belegget er lesbart og etterprøvbart. */
function evidenceAround(text: string, index: number, matchLength: number): string {
  const start = Math.max(0, text.lastIndexOf("\n", index) + 1)
  const nextBreak = text.indexOf("\n", index + matchLength)
  const end = nextBreak === -1 ? text.length : nextBreak
  const line = text.slice(start, end).replace(/\s+/g, " ").trim()
  return line.length > 220 ? `${line.slice(0, 217)}…` : line
}

export function detectSignals(pages: ExtractedPage[]): Signal[] {
  return SIGNAL_KEYS.map((key) => {
    const rule = SIGNAL_RULES[key]
    for (const page of pages) {
      const match = rule.exec(page.text)
      rule.lastIndex = 0
      if (match && match.index !== undefined) {
        return {
          key,
          met: true,
          evidence: evidenceAround(page.text, match.index, match[0].length),
          source_url: page.url,
        }
      }
    }
    return { key, met: false, evidence: "", source_url: null }
  })
}
