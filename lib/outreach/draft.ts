// Generates a short, personalized Norwegian cold-outreach email for a prospect.
// Reuses the chat-completions + JSON-mode pattern from app/api/tilbud/analyse.

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
}

function normalizeJsonFromModel(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  }
  return trimmed
}

export async function generateOutreachDraft(input: DraftInput): Promise<{ subject: string; body: string }> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY mangler")

  const userPrompt = [
    `Bedrift: ${input.name}`,
    input.city ? `Sted: ${input.city}` : null,
    input.naceDescription ? `Bransje: ${input.naceDescription}` : null,
    typeof input.employeeCount === "number" ? `Antall ansatte: ${input.employeeCount}` : null,
    "",
    "Skriv en personlig kald-e-post til denne bedriften.",
  ]
    .filter(Boolean)
    .join("\n")

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`KI-utkast feilet (${response.status})`)
  }

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
