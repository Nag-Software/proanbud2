// Grunding av sitater.
//
// En «krok» er bare verdt noe hvis observasjonen faktisk står på firmaets egen
// side. Ordoverlapp er ikke nok — en modell som skriver «de jobber med bad og
// kjøkken» kan treffe alle ordene uten at setningen finnes. Derfor kreves en
// normalisert ordrett delstreng på minst 4 ord.
//
// Normaliseringen tåler det som varierer uten å endre mening: store/små
// bokstaver, whitespace, bindestreker, anførselstegn og typografiske tegn.
// Den tåler ikke omskriving, og det er hele poenget.

/** Minst 4 ord totalt, og minst 3 av dem meningsbærende. «og i på til» er
 *  fire ord, men sier ingenting — og «av bad» er for lite til å være en krok. */
const MIN_QUOTE_WORDS = 4
const MIN_CONTENT_WORDS = 3

/** Små ord som ikke teller som innhold når vi krever 4 ord. */
const STOPWORDS = new Set([
  "og",
  "i",
  "på",
  "av",
  "til",
  "for",
  "med",
  "en",
  "et",
  "er",
  "som",
  "den",
  "det",
  "de",
  "vi",
  "du",
  "har",
  "kan",
  "fra",
  "om",
  "at",
  "the",
  "and",
  "of",
])

/**
 * Gjør tekst sammenlignbar: små bokstaver, alle typer anførselstegn og
 * bindestreker til standardtegn, all whitespace til ett mellomrom.
 */
export function normalizeForGrounding(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/ /g, " ")
    .replace(/[.,;:!?()[\]{}"'*|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function wordCounts(normalized: string): { total: number; content: number } {
  const words = normalized.split(" ").filter(Boolean)
  return {
    total: words.length,
    content: words.filter((word) => word.length > 1 && !STOPWORDS.has(word)).length,
  }
}

export type GroundingResult = {
  grounded: boolean
  reason: "ok" | "for_kort" | "ikke_funnet" | "tom"
  /** Sitatet slik det faktisk står i kilden, når det er funnet. */
  matched: string | null
}

/**
 * Er sitatet ordrett (etter normalisering) å finne i den hentede teksten?
 *
 * `sourceText` skal være sammenslått tekst fra sidene vi har hentet — aldri
 * noe modellen har skrevet.
 */
export function checkQuoteGrounding(quote: string, sourceText: string): GroundingResult {
  const trimmed = (quote || "").trim()
  if (!trimmed) return { grounded: false, reason: "tom", matched: null }

  const needle = normalizeForGrounding(trimmed)
  const counts = wordCounts(needle)
  if (counts.total < MIN_QUOTE_WORDS || counts.content < MIN_CONTENT_WORDS) {
    return { grounded: false, reason: "for_kort", matched: null }
  }

  const haystack = normalizeForGrounding(sourceText)
  const at = haystack.indexOf(needle)
  if (at === -1) return { grounded: false, reason: "ikke_funnet", matched: null }

  return { grounded: true, reason: "ok", matched: trimmed }
}

/** Kortform der bare ja/nei betyr noe. */
export function isQuoteGrounded(quote: string, sourceText: string): boolean {
  return checkQuoteGrounding(quote, sourceText).grounded
}

/**
 * Alle tall i en tekst må ha dekning et sted. Brukes av lint: et tall som
 * verken står i faktaarket eller i dossieret er en hallusinasjon.
 * Prosent, kroner og årstall normaliseres til bare sifrene.
 */
export function numbersIn(text: string): string[] {
  const found = new Set<string>()
  for (const match of (text || "").matchAll(/\d[\d\s.,]*/g)) {
    const digits = match[0].replace(/[\s.,]/g, "")
    if (digits) found.add(digits)
  }
  return [...found]
}
