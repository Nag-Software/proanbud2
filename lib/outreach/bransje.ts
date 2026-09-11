// Maps a prospect's NACE/industry to one of a small set of construction trades
// ("bransje") that we have a pre-made example offer for. Used by the outbound lead
// engine to link a real, trade-specific example offer in the cold email
// ("slik ville ditt sett ut"), and by the public /eksempel-tilbud/[bransje] page.
//
// nace_code comes from Brønnøysund (naeringskode1.kode). Since 2025 that is
// SN2025 (e.g. "43.340" maler, "43.221" rør, "43.210" elektro, "43.320" snekker,
// "43.410" tak); older rows may still carry SN2007 codes. Classification goes
// through resolveTrade (description first, then code) and falls back to the
// generic "bygg" example so there is ALWAYS a usable example.

import { resolveTrade, type TradeKey } from "@/lib/outreach/segments"

export const BRANSJE_KEYS = ["maler", "tomrer", "rorlegger", "elektriker", "tak", "bygg"] as const

export type BransjeKey = (typeof BRANSJE_KEYS)[number]

/** Human label used in copy, e.g. "et tilbud vi lagde for {label}". */
export const BRANSJE_LABELS: Record<BransjeKey, string> = {
  maler: "et malerfirma",
  tomrer: "et tømrerfirma",
  rorlegger: "et rørleggerfirma",
  elektriker: "et elektrikerfirma",
  tak: "et takfirma",
  bygg: "en byggebedrift",
}

/** Short trade noun for headings, e.g. "Maler", "Rørlegger". */
export const BRANSJE_TRADE: Record<BransjeKey, string> = {
  maler: "Maler",
  tomrer: "Tømrer",
  rorlegger: "Rørlegger",
  elektriker: "Elektriker",
  tak: "Taktekker",
  bygg: "Byggebedrift",
}

export function isBransjeKey(value: string): value is BransjeKey {
  return (BRANSJE_KEYS as readonly string[]).includes(value)
}

/** Fag (SN2025, lib/outreach/segments.ts) → det eksempeltilbudet som passer best. */
const TRADE_TO_BRANSJE: Partial<Record<TradeKey, BransjeKey>> = {
  maler: "maler",
  ror: "rorlegger",
  elektro: "elektriker",
  snekker: "tomrer",
  tak: "tak",
}

/**
 * Bransje for eksempeltilbudet. Går via fagkartet i segments.ts, som leser
 * næringsbeskrivelsen FØR koden: samme sifre betyr forskjellige fag i SN2007 og
 * SN2025 (43.910 var takarbeid, er nå murerarbeid), mens beskrivelsen er entydig.
 * Faller alltid tilbake til det generelle «bygg»-eksempelet.
 */
export function resolveBransje(input: {
  naceCode?: string | null
  naceDescription?: string | null
}): BransjeKey {
  const description = (input.naceDescription || "").toLowerCase()
  // «Tømrer» står i beskrivelsen hos mange 41-firmaer — de får tømrereksempelet.
  if (/tømrer|tomrer/.test(description)) return "tomrer"
  return TRADE_TO_BRANSJE[resolveTrade(input)] ?? "bygg"
}
