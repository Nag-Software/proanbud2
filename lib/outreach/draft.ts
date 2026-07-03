// Generates a short, personalized Norwegian cold-outreach email for a prospect.
// Reuses the chat-completions + JSON-mode pattern from app/api/tilbud/analyse.

import { openaiFetch } from "@/lib/llm/openai-fetch"

const SYSTEM_PROMPT = `Du er en erfaren norsk B2B-selger som skriver kald-e-poster på vegne av Proanbud — en plattform der bygg- og anleggsbedrifter lager komplette tilbud på minutter, og styrer prosjekt, HMS/KS og timeføring i ett system. Målet er å få mottakeren til å starte en gratis prøveperiode.

Mål: høy konvertering, men alltid profesjonell og troverdig.

Regler:
- Skriv på norsk. Vennlig, konkret og respektfull — som en fagperson til en annen, ikke som en reklame.
- Struktur: (1) kort, personlig åpning som viser at vi forstår hverdagen deres (tilbud på kveldstid, marginer, papirarbeid), (2) den viktigste nytten konkret — proffe tilbud på minutter med egne leverandørpriser, (3) én tydelig oppfordring om å prøve gratis i 14 dager (uten binding).
- Maks 100 ord i brødteksten. Korte avsnitt.
- Personaliser til bedriftens navn, sted og type arbeid der det er naturlig — men ikke overdriv.
- Unngå spam-ord og store løfter ("revolusjonerende", "100% garantert", "tjen tusenvis"), KUN STORE BOKSTAVER, og utropstegn-spamming — det skader leveringsdyktighet og troverdighet.
- Avslutt brødteksten med en kort, menneskelig signatur, f.eks. "Mvh\\nCasper, Proanbud". IKKE skriv lenker, kontaktinfo eller avmeldingstekst — knapp og bunntekst legges til automatisk.
- Emnefelt: kort, relevant og profesjonelt, ingen clickbait, ingen emojier.
- Svar KUN som JSON: { "subject": "...", "body": "..." }`

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

function normalizeJsonFromModel(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  }
  return trimmed
}

export async function generateOutreachDraft(input: DraftInput): Promise<{ subject: string; body: string }> {
  const userPrompt = [
    `Bedrift: ${input.name}`,
    input.city ? `Sted: ${input.city}` : null,
    input.naceDescription ? `Bransje: ${input.naceDescription}` : null,
    typeof input.employeeCount === "number" ? `Antall ansatte: ${input.employeeCount}` : null,
    input.exampleLabel
      ? `\nVi har laget et ekte eksempel-tilbud for ${input.exampleLabel} som ligger bak knappen under e-posten. Vri den avsluttende oppfordringen mot å SE dette konkrete eksempelet (f.eks. «se eksempel-tilbudet jeg lagde for ${input.exampleLabel} – slik ville ditt sett ut»), heller enn en generisk «prøv gratis»-oppfordring. IKKE skriv selve lenken – knappen legges til automatisk.`
      : null,
    "",
    "Skriv en personlig kald-e-post til denne bedriften.",
  ]
    .filter(Boolean)
    .join("\n")

  const response = await openaiFetch("chat/completions", {
    model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  })

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const raw = payload.choices?.[0]?.message?.content || "{}"
  const parsed = JSON.parse(normalizeJsonFromModel(raw)) as { subject?: string; body?: string }

  const subject = (parsed.subject || "").trim()
  const body = (parsed.body || "").trim()
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
): Promise<{ subject: string; body: string }> {
  const instruction = REDRAFT_TONES[opts.tone] ?? REDRAFT_TONES.konkret
  const userPrompt = [
    `Bedrift: ${input.name}`,
    input.city ? `Sted: ${input.city}` : null,
    input.naceDescription ? `Bransje: ${input.naceDescription}` : null,
    typeof input.employeeCount === "number" ? `Antall ansatte: ${input.employeeCount}` : null,
    "",
    "Nåværende utkast:",
    `Emne: ${opts.currentSubject || "(tomt)"}`,
    `Melding:\n${opts.currentBody || "(tomt)"}`,
    "",
    `Skriv om dette utkastet. ${instruction}`,
  ]
    .filter(Boolean)
    .join("\n")

  const response = await openaiFetch("chat/completions", {
    model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
    temperature: 0.6,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  })

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const raw = payload.choices?.[0]?.message?.content || "{}"
  const parsed = JSON.parse(normalizeJsonFromModel(raw)) as { subject?: string; body?: string }

  const subject = (parsed.subject || opts.currentSubject || "").trim()
  const body = (parsed.body || "").trim()
  if (!subject || !body) throw new Error("KI returnerte tomt utkast")

  return { subject, body }
}

