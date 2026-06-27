import { randomBytes } from "node:crypto"

import type { AffiliateApplicationInput } from "./types"

/**
 * Referral-code helpers for affiliate partners. A code becomes the share link
 * `https://proanbud.no/r/<code>` on the marketing site, so it must be a clean,
 * URL-safe slug: lowercased, alphanumeric + hyphens, starting alphanumeric.
 * Kept in sync with the marketing site's normalizeCode() (lib/referral.ts).
 */

export function normalizeCode(raw: string | null | undefined): string | null {
  if (!raw) return null
  const code = raw.trim().toLowerCase().slice(0, 64)
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(code) ? code : null
}

/** Build a code base from the partner's company or contact name. */
export function baseFromApplication(input: AffiliateApplicationInput): string {
  const raw = (input.companyName || input.contactName || "selger")
    .replace(/[æå]/gi, "a")
    .replace(/ø/gi, "o")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
  return normalizeCode(raw) ?? "selger"
}

export function randomSuffix(length = 4): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = randomBytes(length)
  let out = ""
  for (let i = 0; i < length; i += 1) out += alphabet[bytes[i] % alphabet.length]
  return out
}
