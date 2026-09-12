// SSRF-sikker HTML-henting. Flyttet ut av lib/outreach/enrich.ts, som nå
// importerer den herfra, slik at research-pipelinen bruker nøyaktig samme
// beskyttelse: bare http/https, ingen credentials i URL-en, bare port 80/443,
// ingen localhost/.local/.internal, DNS slås opp først og adressen må være
// offentlig unicast, og den oppslåtte IP-en pinnes i selve forespørselen slik
// at et DNS-rebind mellom sjekk og kall ikke hjelper. Omdirigeringer følges
// manuelt og sjekkes på nytt hver gang.

import { lookup } from "node:dns/promises"
import http from "node:http"
import https from "node:https"
import type { LookupFunction } from "node:net"

import ipaddr from "ipaddr.js"

const MAX_HTML_BYTES = 1_000_000
const MAX_REDIRECTS = 3

export type FetchedPage = {
  /** URL-en innholdet faktisk kom fra (etter omdirigeringer). Kildelenken. */
  url: string
  html: string
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

/** Henter en side og gir både innholdet og den endelige URL-en. */
export async function fetchPage(
  url: string,
  timeoutMs: number,
  redirectsLeft = MAX_REDIRECTS,
): Promise<FetchedPage | null> {
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

          void fetchPage(new URL(location, target).toString(), timeoutMs, redirectsLeft - 1)
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
        response.on("end", () =>
          resolve({ url: target.toString(), html: Buffer.concat(chunks).toString("utf8") }),
        )
        response.on("error", () => resolve(null))
      },
    )

    request.on("error", () => resolve(null))
  })
}

/** Bakoverkompatibel variant: bare innholdet. */
export async function fetchHtml(url: string, timeoutMs: number): Promise<string | null> {
  const page = await fetchPage(url, timeoutMs)
  return page?.html ?? null
}

/** Samme SSRF-sjekk, men for JSON-API-er vi ikke eier (Regnskapsregisteret). */
export async function fetchJson<T = unknown>(url: string, timeoutMs: number): Promise<T | null> {
  let target: URL
  try {
    target = new URL(url)
  } catch {
    return null
  }
  const resolved = await resolvePublicTarget(target)
  if (!resolved) return null

  try {
    const response = await fetch(target, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  }
}
