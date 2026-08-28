// Best-effort contact enrichment: fetch a prospect's website and extract a
// contact email + phone. Brønnøysund does not always provide these. Coverage is
// partial (~40-70%); prospects without a hit become a phone/call list.
//
// Two sources, in order:
//   1. Brønnøysund (fetchBrregContact) — refetches hjemmeside/epost/telefon for
//      prospects imported before those fields were captured, or registered since.
//   2. Website scrape (enrichFromWebsite) — front page first, then common
//      Norwegian contact pages (/kontakt, /kontakt-oss, /om-oss).

import { lookup } from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import type { LookupFunction } from "node:net"

import ipaddr from "ipaddr.js"

const GENERIC_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const MAILTO = /mailto:([^"'?>\s]+)/gi
const TEL = /tel:([+\d\s]+)/gi
// Norwegian phone: optional +47, then 8 digits (often grouped).
const NO_PHONE = /(?:\+?47[\s]?)?(?:\d[\s]?){8}/g
const MAX_HTML_BYTES = 1_000_000
const MAX_REDIRECTS = 3

const EMAIL_BLOCKLIST = [
  "example.com",
  "sentry",
  "wixpress.com",
  "wix.com",
  "godaddy",
  "w3.org",
  "schema.org",
  "googleapis",
  "gstatic",
  "cloudflare",
  "sentry.io",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
]

/** Typiske norske kontaktside-stier — prøves når forsiden ikke gir e-post. */
const CONTACT_PATHS = ["/kontakt", "/kontakt-oss", "/om-oss"]

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return null
  }
}

function pickBestEmail(candidates: string[], siteHost: string | null): string | null {
  const cleaned = candidates
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@") && !EMAIL_BLOCKLIST.some((b) => e.includes(b)))
  if (cleaned.length === 0) return null

  // Prefer an address on the same domain as the website.
  if (siteHost) {
    const sameDomain = cleaned.find((e) => e.endsWith(`@${siteHost}`) || e.endsWith(`.${siteHost}`))
    if (sameDomain) return sameDomain
  }
  // Then prefer common business mailboxes.
  const preferredLocal = cleaned.find((e) => /^(post|kontakt|firmapost|hei|info)@/.test(e))
  return preferredLocal ?? cleaned[0]
}

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "")
  const local = digits.replace(/^\+?47/, "")
  if (local.length !== 8) return null
  return digits.startsWith("+47") || digits.startsWith("47") ? `+47 ${local}` : local
}

function isPublicAddress(address: string) {
  try {
    const parsed = ipaddr.parse(address)
    const normalized =
      parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
        ? (parsed as ipaddr.IPv6).toIPv4Address()
        : parsed
    return normalized.range() === "unicast"
  } catch {
    return false
  }
}

async function resolvePublicTarget(target: URL) {
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    (target.port && target.port !== "80" && target.port !== "443")
  ) {
    return null
  }

  const hostname = target.hostname.toLowerCase().replace(/\.$/, "")
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return null
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => [])
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    return null
  }

  return addresses[0]
}

async function fetchHtml(url: string, timeoutMs: number, redirectsLeft = MAX_REDIRECTS): Promise<string | null> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }

  const resolved = await resolvePublicTarget(target)
  if (!resolved) return null

  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, resolved.address, resolved.family)
  }
  const transport = target.protocol === "https:" ? https : http

  return new Promise((resolve) => {
    const request = transport.get(
      target,
      {
        headers: {
          "User-Agent": "ProanbudBot/1.0 (+https://proanbud.no)",
          Accept: "text/html,application/xhtml+xml",
        },
        lookup: pinnedLookup,
        signal: AbortSignal.timeout(timeoutMs),
      },
      (response) => {
        const status = response.statusCode ?? 0
        const location = response.headers.location

        if (status >= 300 && status < 400 && location) {
          response.resume()
          if (redirectsLeft <= 0) {
            resolve(null)
            return
          }

          void fetchHtml(new URL(location, target).toString(), timeoutMs, redirectsLeft - 1)
            .then(resolve)
            .catch(() => resolve(null))
          return
        }

        const contentType = response.headers["content-type"]?.toLowerCase() ?? ""
        if (status < 200 || status >= 300 || (contentType && !contentType.includes("html"))) {
          response.resume()
          resolve(null)
          return
        }

        const chunks: Buffer[] = []
        let received = 0
        response.on("data", (chunk: Buffer) => {
          received += chunk.length
          if (received > MAX_HTML_BYTES) {
            request.destroy()
            resolve(null)
            return
          }
          chunks.push(chunk)
        })
        response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")))
        response.on("error", () => resolve(null))
      }
    )

    request.on("error", () => resolve(null))
  })
}

function extractContacts(html: string, siteHost: string | null): EnrichResult {
  const emailCandidates: string[] = []
  for (const m of html.matchAll(MAILTO)) emailCandidates.push(decodeURIComponent(m[1]))
  for (const m of html.matchAll(GENERIC_EMAIL)) emailCandidates.push(m[0])
  const email = pickBestEmail(emailCandidates, siteHost)

  let phone: string | null = null
  const telMatch = [...html.matchAll(TEL)][0]
  if (telMatch) phone = normalizePhone(telMatch[1])
  if (!phone) {
    for (const m of html.matchAll(NO_PHONE)) {
      const p = normalizePhone(m[0])
      if (p) {
        phone = p
        break
      }
    }
  }

  return { email, phone }
}

export type EnrichResult = { email: string | null; phone: string | null }

export async function enrichFromWebsite(website: string | null): Promise<EnrichResult> {
  if (!website) return { email: null, phone: null }

  const siteHost = hostOf(website)
  const frontHtml = await fetchHtml(website, 8000)
  const result: EnrichResult = frontHtml
    ? extractContacts(frontHtml, siteHost)
    : { email: null, phone: null }
  if (result.email) return result

  // Forsiden ga ingen e-post — prøv de vanlige kontaktsidene før vi gir oss.
  let origin: string
  try {
    origin = new URL(website).origin
  } catch {
    return result
  }
  for (const path of CONTACT_PATHS) {
    const html = await fetchHtml(`${origin}${path}`, 6000)
    if (!html) continue
    const contacts = extractContacts(html, siteHost)
    if (contacts.email) {
      return { email: contacts.email, phone: result.phone ?? contacts.phone }
    }
    if (!result.phone && contacts.phone) result.phone = contacts.phone
  }
  return result
}

export type BrregContact = { website: string | null; email: string | null; phone: string | null }

/** Hent kontaktfeltene på nytt fra Brønnøysund for ett org.nr. Dekker prospekter
 *  der hjemmeside/e-post/telefon manglet ved import eller er registrert senere. */
export async function fetchBrregContact(orgNumber: string): Promise<BrregContact | null> {
  try {
    const res = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter/${orgNumber}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    })
    if (!res.ok) return null
    const enhet = (await res.json()) as {
      hjemmeside?: string
      epostadresse?: string
      telefon?: string
      mobil?: string
    }
    const websiteRaw = enhet.hjemmeside?.trim() || null
    const email = enhet.epostadresse?.trim().toLowerCase() || null
    return {
      website: websiteRaw ? (websiteRaw.startsWith("http") ? websiteRaw : `https://${websiteRaw}`) : null,
      email: email && email.includes("@") ? email : null,
      phone: enhet.telefon?.trim() || enhet.mobil?.trim() || null,
    }
  } catch {
    return null
  }
}
