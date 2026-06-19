// Best-effort contact enrichment: fetch a prospect's website and extract a
// contact email + phone. Brønnøysund does not provide these. Coverage is
// partial (~40-70%); prospects without a hit become a phone/call list.

const GENERIC_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const MAILTO = /mailto:([^"'?>\s]+)/gi
const TEL = /tel:([+\d\s]+)/gi
// Norwegian phone: optional +47, then 8 digits (often grouped).
const NO_PHONE = /(?:\+?47[\s]?)?(?:\d[\s]?){8}/g

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

export type EnrichResult = { email: string | null; phone: string | null }

export async function enrichFromWebsite(website: string | null): Promise<EnrichResult> {
  if (!website) return { email: null, phone: null }

  let html = ""
  try {
    const res = await fetch(website, {
      headers: { "User-Agent": "ProanbudBot/1.0 (+https://proanbud.no)", Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
      redirect: "follow",
    })
    if (!res.ok) return { email: null, phone: null }
    html = await res.text()
  } catch {
    return { email: null, phone: null }
  }

  const siteHost = hostOf(website)

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
