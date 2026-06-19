// Generates a short, personalized Norwegian cold-outreach email for a prospect.
// Reuses the chat-completions + JSON-mode pattern from app/api/tilbud/analyse.

const SYSTEM_PROMPT = `Du skriver korte, personlige og profesjonelle kald-e-poster på vegne av Proanbud — en norsk plattform der bygg- og anleggsbedrifter lager KI-genererte tilbud på minutter, og styrer prosjekt, HMS/KS og timeføring i ett system.

Regler:
- Skriv på norsk, vennlig og konkret. Ingen selgende klisjeer eller overdrivelser.
- Maks 90 ord i brødteksten. Ett kort åpningsavsnitt som viser at vi vet hvem de er, én tydelig nytte, og én myk oppfordring: prøv gratis i 14 dager.
- Personaliser til bedriftens navn, sted og type arbeid der det er naturlig.
- IKKE skriv signatur, kontaktinfo eller avmeldingstekst — det legges til automatisk.
- Emnefelt: kort og relevant, ingen clickbait, ingen emojier.
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
