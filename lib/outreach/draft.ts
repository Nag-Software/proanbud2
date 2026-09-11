// Generates a short, personalized Norwegian cold-outreach email for a prospect.
// Reuses the chat-completions + JSON-mode pattern from app/api/tilbud/analyse.
//
// Faktabrannmuren: prompten får BARE de verifiserte påstandene i
// lib/outreach/facts.ts, og svaret sjekkes mot forbudslistene etterpå. Bryter
// utkastet dem, skrives det om én gang med konkret tilbakemelding.

import { openaiFetch } from "@/lib/llm/openai-fetch"
import { factsForPrompt, findBannedClaims, findBannedWords } from "@/lib/outreach/facts"

const SIGNATURE = "Casper Nag\nProanbud — et produkt fra Nag Software, Holmestrand"

function systemPrompt(): string {
  return `Du skriver kalde førstekontakt-e-poster på vegne av Casper Nag, som har laget Proanbud — et norsk system for håndverksbedrifter der tilbud, prosjekter, timer og faktura henger sammen. Målet er et svar, ikke et salg.

Stil (Caspers egen):
- Norsk bokmål. Kort. Skriv som noen som har stått på en byggeplass, ikke som en reklame.
- Start med «Hei,» på egen linje.
- Første setning er én konkret og sann observasjon om akkurat denne bedriften — bare fra opplysningene du får. Finn aldri på noe. Har du lite å gå på, hold deg nøkternt til fag og sted.
- Deretter én til to setninger om hva Proanbud gjør, med ordene fra faktaarket.
- Avslutt med ETT lavterskel-spørsmål. Aldri «book et møte».
- Maks 120 ord før signaturen. Ingen emojier. Ingen utropstegn.
- Aldri ordene: løsning, synergi, digitalisering, effektivisering, sømløs, revolusjonerende, banebrytende.
- Ikke skriv lenker, kontaktinfo eller avmeldingstekst — det legges til automatisk.
- Avslutt med nøyaktig denne signaturen:
${SIGNATURE}

Faktaarket — dette er ALT du kan påstå om Proanbud:
${factsForPrompt("handverker")}

Aldri:
- tall, prosenter, kundehistorier eller sitater som ikke står i faktaarket
- «norske servere», DocuSign, eller at teksten er KI-generert
- pris sammen med faktura til Tripletex/Fiken uten også å si hva integrasjonen koster (inkludert i Proff, tillegg på Mini)

Emnefelt: 2–5 ord, konkret, ingen clickbait, ingen emojier.
Svar KUN som JSON: { "subject": "...", "body": "..." }`
}

type DraftInput = {
  name: string
  city?: string | null
  naceDescription?: string | null
  employeeCount?: number | null
  /** Human label for a real example offer linked behind the email's CTA button,
   *  e.g. "et malerfirma". When set, the copy points to that concrete example
   *  ("slik ville ditt sett ut") instead of a generic trial pitch. */
  exampleLabel?: string | null
}

type Draft = { subject: string; body: string }

function normalizeJsonFromModel(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  }
  return trimmed
}

function model(): string {
  return process.env.OPENAI_MODEL || "gpt-5.2-mini"
}

/** gpt-5-familien avviser temperature ≠ 1 — send den bare til eldre modeller. */
function temperatureFor(value: number): { temperature?: number } {
  return /^gpt-5/i.test(model()) ? {} : { temperature: value }
}

function companyLines(input: DraftInput): string[] {
  return [
    `Bedrift: ${input.name}`,
    input.city ? `Sted: ${input.city}` : null,
    input.naceDescription ? `Bransje: ${input.naceDescription}` : null,
    typeof input.employeeCount === "number" ? `Antall ansatte: ${input.employeeCount}` : null,
  ].filter((line): line is string => Boolean(line))
}

async function complete(userPrompt: string, temperature: number): Promise<Draft> {
  const response = await openaiFetch("chat/completions", {
    model: model(),
    ...temperatureFor(temperature),
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt() },
      { role: "user", content: userPrompt },
    ],
  })
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const raw = payload.choices?.[0]?.message?.content || "{}"
  const parsed = JSON.parse(normalizeJsonFromModel(raw)) as { subject?: string; body?: string }
  return { subject: (parsed.subject || "").trim(), body: (parsed.body || "").trim() }
}

function problemsWith(draft: Draft): string[] {
  const text = `${draft.subject}\n${draft.body}`
  return [
    ...findBannedClaims(text),
    ...findBannedWords(text).map((word) => `Ordet «${word}» er ikke lov`),
    ...(/!/.test(draft.body) ? ["Ingen utropstegn"] : []),
  ]
}

/** Generer, sjekk mot faktabrannmuren, og skriv om én gang ved brudd. */
async function completeGuarded(userPrompt: string, temperature: number): Promise<Draft> {
  const first = await complete(userPrompt, temperature)
  const problems = problemsWith(first)
  if (problems.length === 0) return first

  const second = await complete(
    `${userPrompt}\n\nForrige utkast brøt reglene:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nForrige utkast:\nEmne: ${first.subject}\n${first.body}\n\nSkriv det om uten disse feilene.`,
    temperature,
  )
  return problemsWith(second).length <= problems.length ? second : first
}

export async function generateOutreachDraft(input: DraftInput): Promise<Draft> {
  const userPrompt = [
    ...companyLines(input),
    input.exampleLabel
      ? `\nVi har laget et ekte eksempel-tilbud for ${input.exampleLabel} som ligger bak knappen under e-posten. Du kan vise til at de kan se det, men IKKE skriv selve lenken – knappen legges til automatisk.`
      : null,
    "",
    "Skriv en personlig kald-e-post til denne bedriften.",
  ]
    .filter((line) => line !== null)
    .join("\n")

  const { subject, body } = await completeGuarded(userPrompt, 0.5)
  if (!subject || !body) throw new Error("KI returnerte tomt utkast")
  return { subject, body }
}

/** One-tap tone instructions for the approval-card "skriv om"-chips. */
export const REDRAFT_TONES = {
  kortere: "Gjør e-posten merkbart kortere og mer konsis. Behold det viktigste.",
  vennligere: "Gjør tonen varmere og mer personlig, som en fagperson til en annen.",
  konkret: "Gjør den mer konkret — pek på én spesifikk nytte og et tydelig neste steg.",
  ny_vinkel: "Skriv den om med en helt ny åpning og vinkel enn nåværende utkast.",
} as const

export type RedraftTone = keyof typeof REDRAFT_TONES

/** Rewrite an existing cold-email draft with a one-tap tone, so the seller can
 *  improve a draft without typing. Keeps the same Proanbud rules as the first draft. */
export async function regenerateOutreachDraft(
  input: DraftInput,
  opts: { tone: RedraftTone; currentSubject?: string | null; currentBody?: string | null },
): Promise<Draft> {
  const instruction = REDRAFT_TONES[opts.tone] ?? REDRAFT_TONES.konkret
  const userPrompt = [
    ...companyLines(input),
    "",
    "Nåværende utkast:",
    `Emne: ${opts.currentSubject || "(tomt)"}`,
    `Melding:\n${opts.currentBody || "(tomt)"}`,
    "",
    `Skriv om dette utkastet. ${instruction}`,
  ].join("\n")

  const draft = await completeGuarded(userPrompt, 0.6)
  const subject = (draft.subject || opts.currentSubject || "").trim()
  if (!subject || !draft.body) throw new Error("KI returnerte tomt utkast")
  return { subject, body: draft.body }
}
