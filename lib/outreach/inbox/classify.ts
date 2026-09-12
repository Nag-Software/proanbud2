// Klassifisering av svar.
//
// Heuristikk først, modell etterpå. Grunnen er ikke bare kostnad: et autosvar
// er en av de få tingene som er trygt å avgjøre i kode, og det er også den
// klassen der en feil koster mest. Tolker vi «Jeg er på ferie til 5. august»
// som et positivt svar, stopper sekvensen og Casper får en oppgave om å ringe
// noen som ikke er på jobb.

import { asRecord, asString, structuredCall, type TokenUsage } from "@/lib/llm/structured"
import type { RawMessage } from "@/lib/outreach/inbox/imap"

export const REPLY_CLASSES = [
  "positiv",
  "sporsmal",
  "ikke_na",
  "nei",
  "avmelding",
  "feil_person",
  "autosvar",
  "ikke_levert",
  "ukjent",
] as const

export type ReplyClass = (typeof REPLY_CLASSES)[number]

export const REPLY_CLASS_LABELS: Record<ReplyClass, string> = {
  positiv: "Positivt svar",
  sporsmal: "Spørsmål",
  ikke_na: "Ikke nå",
  nei: "Nei takk",
  avmelding: "Avmelding",
  feil_person: "Feil person",
  autosvar: "Autosvar",
  ikke_levert: "Ikke levert",
  ukjent: "Uklart",
}

export type Classification = {
  klasse: ReplyClass
  confidence: number
  summary: string
  /** Returdato fra et autosvar, eller datoen et «ta kontakt etter jul» peker på. */
  back_at: string | null
  usage: TokenUsage | null
}

// ── Heuristikk ──────────────────────────────────────────────────────────────

const AUTOREPLY_SUBJECT =
  /\b(automatisk svar|autosvar|fravær|fraværsmelding|ferie|out of office|automatic reply|ute av kontoret|abwesenheit)\b/i

const AUTOREPLY_HEADERS = /\b(this is an automatic reply|jeg er for tiden|jeg er ute av kontoret)\b/i

const BOUNCE =
  /\b(mail delivery (failed|subsystem)|undelivered mail|delivery status notification|returned to sender|adressen finnes ikke|550 5\.1\.1|recipient address rejected)\b/i

const UNSUBSCRIBE =
  /\b(meld meg av|meld oss av|fjern meg|fjern oss|slett meg|ikke send (meg|oss) mer|unsubscribe|stopp disse|reserverer meg)\b/i

const MONTHS: Record<string, number> = {
  januar: 1,
  februar: 2,
  mars: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  desember: 12,
}

/** «tilbake 5. august» eller «tilbake 05.08.2026» → ISO-dato. */
export function parseReturnDate(text: string, now = new Date()): string | null {
  const lower = text.toLowerCase()

  const named = lower.match(
    /(\d{1,2})\.?\s*(januar|februar|mars|april|mai|juni|juli|august|september|oktober|november|desember)/,
  )
  if (named) {
    const day = Number(named[1])
    const month = MONTHS[named[2]]
    let year = now.getUTCFullYear()
    // Ligger datoen bak oss, mente de neste år.
    if (month < now.getUTCMonth() + 1 || (month === now.getUTCMonth() + 1 && day < now.getUTCDate())) {
      year += 1
    }
    return new Date(Date.UTC(year, month - 1, day, 8)).toISOString()
  }

  const numeric = lower.match(/(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?/)
  if (numeric) {
    const day = Number(numeric[1])
    const month = Number(numeric[2])
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let year = numeric[3] ? Number(numeric[3]) : now.getUTCFullYear()
      if (year < 100) year += 2000
      const candidate = new Date(Date.UTC(year, month - 1, day, 8))
      if (!numeric[3] && candidate < now) candidate.setUTCFullYear(year + 1)
      return candidate.toISOString()
    }
  }

  if (/\b(etter jul|over nyttår|på nyåret)\b/.test(lower)) {
    return new Date(Date.UTC(now.getUTCFullYear() + (now.getUTCMonth() >= 11 ? 1 : 0), 0, 8, 8)).toISOString()
  }
  if (/\b(etter ferien|etter sommeren|til høsten)\b/.test(lower)) {
    const year = now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear()
    return new Date(Date.UTC(year, 7, 8, 8)).toISOString()
  }

  return null
}

/** Avgjørelser som er trygge å ta i kode. Null = spør modellen. */
export function heuristicClass(message: RawMessage): Classification | null {
  const subject = message.subject || ""
  const text = message.text || ""
  const both = `${subject}\n${text}`

  if (BOUNCE.test(both)) {
    return {
      klasse: "ikke_levert",
      confidence: 0.95,
      summary: "Meldingen kom i retur",
      back_at: null,
      usage: null,
    }
  }

  if (AUTOREPLY_SUBJECT.test(subject) || AUTOREPLY_HEADERS.test(text)) {
    return {
      klasse: "autosvar",
      confidence: 0.9,
      summary: "Automatisk fraværsmelding",
      back_at: parseReturnDate(both),
      usage: null,
    }
  }

  // Avmelding er et rettskrav, ikke en smakssak. Står det der, er det et nei.
  if (UNSUBSCRIBE.test(both)) {
    return {
      klasse: "avmelding",
      confidence: 0.9,
      summary: "Ber om å bli meldt av",
      back_at: null,
      usage: null,
    }
  }

  return null
}

// ── Modellen ────────────────────────────────────────────────────────────────

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["klasse", "sikkerhet", "oppsummering", "retur_dato"],
  properties: {
    klasse: {
      type: "string",
      enum: ["positiv", "sporsmal", "ikke_na", "nei", "feil_person", "avmelding", "ukjent"],
    },
    sikkerhet: { type: "number", minimum: 0, maximum: 1 },
    oppsummering: { type: "string", description: "Én setning på norsk om hva de sier." },
    retur_dato: {
      type: ["string", "null"],
      description: "ISO-dato hvis de ber oss komme tilbake på et tidspunkt. Ellers null.",
    },
  },
}

const SYSTEM = `Du klassifiserer svar på kalde B2B-e-poster på norsk.

Klassene:
- positiv: de er interessert, vil se mer, eller ber om et møte
- sporsmal: de stiller et konkret spørsmål før de bestemmer seg
- ikke_na: interessert i prinsippet, men ikke nå (travelt, feil tidspunkt, ta kontakt senere)
- nei: de vil ikke, uansett grunn
- feil_person: de er ikke rett mottaker, eller viser videre til noen andre
- avmelding: de ber uttrykkelig om å slippe flere e-poster
- ukjent: du klarer ikke å avgjøre

Vær forsiktig. «Send meg mer info» er positiv. «Vi har allerede et system» er nei. «Ta kontakt i august» er ikke_na med retur_dato.`

export async function classifyReply(message: RawMessage): Promise<Classification> {
  const heuristic = heuristicClass(message)
  if (heuristic) return heuristic

  const result = await structuredCall(
    {
      model: process.env.SALG_CLASSIFY_MODEL || process.env.OPENAI_MODEL || "gpt-5.2-mini",
      schemaName: "svar_klasse",
      schema: SCHEMA,
      system: SYSTEM,
      user: `Emne: ${message.subject ?? "(uten emne)"}\nFra: ${message.fromEmail}\n\n${message.text.slice(0, 4000)}`,
      maxOutputTokens: 400,
      timeoutMs: 25000,
      effort: "low",
    },
    (value) => {
      const root = asRecord(value)
      const klasse = asString(root.klasse) as ReplyClass
      return {
        klasse: REPLY_CLASSES.includes(klasse) ? klasse : ("ukjent" as ReplyClass),
        confidence: typeof root.sikkerhet === "number" ? root.sikkerhet : 0.5,
        summary: asString(root.oppsummering),
        back_at: typeof root.retur_dato === "string" ? root.retur_dato : null,
      }
    },
  )

  // Klarer ikke modellen å svare, er «ukjent» riktig utfall: da havner
  // meldingen hos Casper i stedet for at maskinen gjetter.
  if (!result.ok) {
    return {
      klasse: "ukjent",
      confidence: 0,
      summary: `Kunne ikke klassifisere (${result.error})`,
      back_at: null,
      usage: result.usage,
    }
  }

  return {
    ...result.data,
    back_at: result.data.back_at ?? parseReturnDate(message.text),
    usage: result.usage,
  }
}

/** Klasser der et menneske må gjøre noe nå. */
export const NEEDS_HUMAN: ReadonlySet<ReplyClass> = new Set(["positiv", "sporsmal", "ukjent"])

/** Klasser som stopper sekvensen. Autosvar gjør det bevisst IKKE. */
export const STOPS_SEQUENCE: ReadonlySet<ReplyClass> = new Set([
  "positiv",
  "sporsmal",
  "ikke_na",
  "nei",
  "avmelding",
  "ikke_levert",
])
