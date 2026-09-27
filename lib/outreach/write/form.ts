// Formen på e-posten — avsnitt og signatur — bestemmes i kode.
//
// Modellen ble bedt om å avslutte med signaturen, men ingenting sjekket det: i
// testkjøringen 27. september manglet den i alle fire utkast. Avsnittene kom
// som enkle linjeskift, som blir én tett blokk i en ren tekst-e-post. Begge
// deler er form, ikke innhold — modellen skriver teksten, koden setter den opp.
//
// Rene funksjoner, så lint og testene kan bruke dem (generate.ts drar inn
// server-only via feilloggen).

/**
 * Caspers signatur, slik han selv vil ha den (27.09): kort, uten «et produkt
 * fra Nag Software». Hvem avsenderen er — Nag Software, adresse og org.nr. —
 * står i bunnteksten (templates.ts), som loven krever.
 */
export const SIGNATURE = "Mvh Casper\nProanbud.no"

/** «Mvh», «Mvh Casper», «Med vennlig hilsen», «Hilsen Casper» … */
const SIGN_OFF = /^(med\s+vennlig\s+hilsen|vennlig\s+hilsen|beste\s+hilsen|hilsen|mvh|vh)\b/i
/** «Casper», «Casper Nag», «– Casper». */
const NAME = /^[-–—\s]*casper(\s+nag)?\b/i
/** «Proanbud.no», eller en firmalinje modellen fant på selv. */
const TAGLINE = /^((https?:\/\/)?(www\.)?proanbud(\.no)?\/?\.?$|proanbud\s*[—–-]|nag software\b)/i

/**
 * Hører linjen til avslutningen — hilsen, navn, firmalinje eller tom linje?
 * Aldri et spørsmål: det er siste setning i e-posten, og den skal stå.
 */
function isClosingLine(line: string): boolean {
  const text = line.trim()
  if (!text) return true
  if (text.includes("?") || text.length > 80) return false
  return SIGN_OFF.test(text) || NAME.test(text) || TAGLINE.test(text)
}

/**
 * Teksten uten signatur og avslutningshilsen — det som faktisk er skrevet til
 * mottakeren. Bare linjene helt til slutt tas bort: står det noe etter
 * signaturen, er det en del av e-posten og skal sjekkes som resten.
 */
export function withoutSignature(body: string): string {
  const lines = body.replace(/\r\n?/g, "\n").split("\n")
  while (lines.length > 0 && isClosingLine(lines[lines.length - 1])) lines.pop()
  return lines.join("\n").trim()
}

/**
 * Brødteksten slik den skal sendes: «Hei,» for seg, ett avsnitt per linje med
 * tom linje mellom, og Caspers signatur til slutt — alltid nøyaktig én.
 * Idempotent: en ferdig tekst kommer uendret ut igjen.
 */
export function finishBody(raw: string): string {
  const paragraphs = withoutSignature(raw)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  // «Hei, jeg så at …» på én linje → «Hei,» på egen linje.
  const greeting = /^(hei|hallo)\s*,\s*(\S.*)$/i.exec(paragraphs[0] ?? "")
  if (greeting) {
    const rest = greeting[2]
    paragraphs.splice(0, 1, `${greeting[1]},`, rest.charAt(0).toUpperCase() + rest.slice(1))
  }

  return [...paragraphs, SIGNATURE].join("\n\n")
}
