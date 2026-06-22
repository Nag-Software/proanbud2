// Maps a prospect's NACE/industry to one of a small set of construction trades
// ("bransje") that we have a pre-made example offer for. Used by the outbound lead
// engine to link a real, trade-specific example offer in the cold email
// ("slik ville ditt sett ut"), and by the public /eksempel-tilbud/[bransje] page.
//
// nace_code comes from Brønnøysund (naeringskode1.kode) in dotted SN2007 form,
// e.g. "43.341" (malerarbeid), "43.22" (VVS/rørlegger), "43.21" (elektro),
// "43.32" (snekkerarbeid), "43.91" (takarbeid). We normalize to digits and match
// on the leading prefix, then fall back to keywords in nace_description, then to
// the generic "bygg" example so there is ALWAYS a usable example.

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

/** NACE digit-prefix → bransje. Order matters: most specific (4-digit) first. */
const NACE_PREFIX_RULES: Array<{ prefix: string; bransje: BransjeKey }> = [
  { prefix: "4334", bransje: "maler" }, // 43.34 Maler- og glassarbeid
  { prefix: "4322", bransje: "rorlegger" }, // 43.22 VVS-arbeid
  { prefix: "4321", bransje: "elektriker" }, // 43.21 Elektrisk installasjonsarbeid
  { prefix: "4332", bransje: "tomrer" }, // 43.32 Snekkerarbeid
  { prefix: "4391", bransje: "tak" }, // 43.91 Takarbeid
]

/** Keyword fallbacks on the free-text NACE description (lowercased, no diacritics-sensitivity). */
const DESCRIPTION_RULES: Array<{ match: RegExp; bransje: BransjeKey }> = [
  { match: /\b(maler|malerarbeid|overflatebehandl)/, bransje: "maler" },
  { match: /\b(rørlegg|roerlegg|rorlegg|vvs|sanitær|sanitaer)/, bransje: "rorlegger" },
  { match: /\b(elektr)/, bransje: "elektriker" },
  { match: /\b(tømrer|tomrer|snekker|trearbeid)/, bransje: "tomrer" },
  { match: /\b(tak|tekking|taktekk|blikkenslag)/, bransje: "tak" },
]

export function resolveBransje(input: {
  naceCode?: string | null
  naceDescription?: string | null
}): BransjeKey {
  const digits = (input.naceCode || "").replace(/\D/g, "")
  if (digits) {
    for (const rule of NACE_PREFIX_RULES) {
      if (digits.startsWith(rule.prefix)) return rule.bransje
    }
  }

  const description = (input.naceDescription || "").toLowerCase()
  if (description) {
    for (const rule of DESCRIPTION_RULES) {
      if (rule.match.test(description)) return rule.bransje
    }
  }

  return "bygg"
}
