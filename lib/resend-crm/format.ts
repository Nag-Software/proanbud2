// Tekst som flettes rett inn i e-postene i Resend («Prøven til {{firmanavn}}
// går ut {{proeve_slutt}}»). Ren modul uten avhengigheter, så den kan testes
// og brukes fra engangsskript.

/** Selskapsformer som skal stå i store bokstaver. */
const COMPANY_FORMS = new Set(["AS", "ASA", "ANS", "DA", "ENK", "SA", "BA", "NUF", "KS", "IKS", "SE"])
/** Småord som står med liten bokstav midt i et navn. */
const SMALL_WORDS = new Set(["og", "i", "på", "av", "for", "til"])
const VOWELS = /[AEIOUYÆØÅ]/

function prettyPart(part: string): string {
  if (!part) return part
  // Forkortelser uten vokal («DS», «MG», «BMT») er initialer — la dem stå.
  if (!VOWELS.test(part)) return part
  return part.charAt(0) + part.slice(1).toLocaleLowerCase("nb-NO")
}

/**
 * Brreg leverer firmanavn i versaler («BYGGMESTER MARIUS THORSEN AS»). Midt i
 * en personlig e-post ser det ut som roping. Navn som bare har store bokstaver
 * skrives om til «Byggmester Marius Thorsen AS»; navn brukeren selv har skrevet
 * med små og store bokstaver røres ikke.
 */
export function prettyCompanyName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ")
  if (!trimmed) return ""
  const hasLetters = /\p{L}/u.test(trimmed)
  const isAllCaps = hasLetters && trimmed === trimmed.toLocaleUpperCase("nb-NO")
  if (!isAllCaps) return trimmed

  return trimmed
    .split(" ")
    .map((word, index) => {
      if (COMPANY_FORMS.has(word)) return word
      const lower = word.toLocaleLowerCase("nb-NO")
      if (index > 0 && SMALL_WORDS.has(lower)) return lower
      return word.split("-").map(prettyPart).join("-")
    })
    .join(" ")
}

/**
 * «15. oktober» — datoen prøven slutter, i norsk tid. trial_ends_at ligger i
 * UTC; en prøve som slutter 00:30 norsk tid den 15. er 14. i UTC, og da ville
 * e-posten sagt feil dag.
 */
export function formatTrialEnd(trialEndsAt: string | Date | null | undefined): string {
  if (!trialEndsAt) return ""
  const date = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", timeZone: "Europe/Oslo" }).format(date)
}
