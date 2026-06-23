// Generates a short, personalized Norwegian cold-outreach email for a prospect.
// Reuses the chat-completions + JSON-mode pattern from app/api/tilbud/analyse.

import { openaiFetch } from "@/lib/llm/openai-fetch"

const SYSTEM_PROMPT = `Du er en erfaren norsk B2B-selger som skriver kald-e-poster på vegne av Proanbud — en plattform der bygg- og anleggsbedrifter lager KI-genererte tilbud på minutter, og styrer prosjekt, HMS/KS og timeføring i ett system. Målet er å få mottakeren til å starte en gratis prøveperiode.

Mål: høy konvertering, men alltid profesjonell og troverdig.

Regler:
- Skriv på norsk. Vennlig, konkret og respektfull — som en fagperson til en annen, ikke som en reklame.
- Struktur: (1) kort, personlig åpning som viser at vi forstår hverdagen deres (tilbud på kveldstid, marginer, papirarbeid), (2) den viktigste nytten konkret — proffe tilbud på minutter med KI fra egne leverandørpriser, (3) én tydelig oppfordring om å prøve gratis i 14 dager (uten binding).
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

// Follow-up emails (steps 1..N) reuse the same chat-completions + JSON-mode pattern,
// but each step has a distinct angle so the sequence doesn't feel like a robot
// re-sending the same pitch. They are deliberately shorter than the first email and
// always reference that we reached out before.
const FOLLOWUP_SYSTEM_PROMPT = `Du er en erfaren norsk B2B-selger som skriver KORTE oppfølgings-e-poster på vegne av Proanbud — en plattform der bygg- og anleggsbedrifter lager KI-genererte tilbud på minutter, og styrer prosjekt, HMS/KS og timeføring i ett system. Du har allerede sendt minst én e-post til denne bedriften, og de har ikke svart ennå. Dette er en oppfølging i samme tråd.

Mål: en vennlig, lavmælt påminnelse som øker sjansen for svar — aldri masete eller desperat.

Regler:
- Skriv på norsk. Kort, varmt og respektfullt — som en fagperson som tar en lett oppfølging, ikke en selger som presser.
- MAKS 60 ord i brødteksten. Helst kortere. Korte avsnitt.
- Referer naturlig til at du tok kontakt tidligere ("jeg hørte ikke fra deg", "fikk du sett på e-posten min"), men ikke gjenta hele pitchen fra forrige e-post.
- Bruk vinkelen du får oppgitt for dette steget. Varier — ikke si det samme som sist.
- Unngå spam-ord, store løfter, KUN STORE BOKSTAVER og utropstegn-spamming.
- Avslutt med en kort, menneskelig signatur, f.eks. "Mvh\\nCasper, Proanbud". IKKE skriv lenker, kontaktinfo eller avmeldingstekst — knapp og bunntekst legges til automatisk.
- Svar KUN som JSON: { "body": "..." }`

const FOLLOWUP_STEP_ANGLES: Record<number, string> = {
  1: 'Vinkel: VENNLIG PÅMINNELSE. Bare en lett "fikk du sett på dette?"-oppfølging. Hold den ekstra kort og uforpliktende.',
  2: 'Vinkel: KONKRET NYTTE. Gi ett konkret, troverdig eksempel på verdien — f.eks. at et tilbud som tar en kveld ellers er ferdig på minutter med KI fra egne leverandørpriser. Ny vinkel, ikke gjenta forrige.',
  3: 'Vinkel: VENNLIG AVSLUTNING. Si at dette er siste gang du tar kontakt, at du ikke vil mase, og at de bare kan si fra (eller prøve gratis) om det er aktuelt. Lavt press, døren på gløtt.',
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

/** Threaded reply subject for a follow-up: "Re: <original>" (no double "Re:"). */
export function followupSubject(previousSubject?: string | null): string {
  const base = (previousSubject || "").replace(/^\s*(re:\s*)+/i, "").trim()
  return base ? `Re: ${base}` : "Re: Proanbud"
}

/** Generate the body for follow-up email `step` (1..N) in an existing thread. */
export async function generateFollowupDraft(
  input: DraftInput,
  step: number,
): Promise<{ body: string }> {
  const angle = FOLLOWUP_STEP_ANGLES[step] || FOLLOWUP_STEP_ANGLES[1]
  const userPrompt = [
    `Bedrift: ${input.name}`,
    input.city ? `Sted: ${input.city}` : null,
    input.naceDescription ? `Bransje: ${input.naceDescription}` : null,
    typeof input.employeeCount === "number" ? `Antall ansatte: ${input.employeeCount}` : null,
    "",
    `Dette er oppfølging nr. ${step}. ${angle}`,
    input.exampleLabel
      ? `Bak knappen under ligger et ekte eksempel-tilbud vi lagde for ${input.exampleLabel}. Bruk det som det konkrete eksempelet: oppfordre kort til å se «eksempel-tilbudet under – slik ville ditt sett ut». IKKE skriv selve lenken.`
      : null,
    "Skriv en kort oppfølgings-e-post til denne bedriften.",
  ]
    .filter(Boolean)
    .join("\n")

  const response = await openaiFetch("chat/completions", {
    model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: FOLLOWUP_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  })

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const raw = payload.choices?.[0]?.message?.content || "{}"
  const parsed = JSON.parse(normalizeJsonFromModel(raw)) as { body?: string }

  const body = (parsed.body || "").trim()
  if (!body) throw new Error("KI returnerte tomt oppfølgingsutkast")

  return { body }
}
