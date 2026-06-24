// Generates a suggested Norwegian reply to a customer message thread, on behalf
// of a tradesperson/contractor company. Reuses the chat-completions + JSON-mode
// pattern from lib/outreach/draft.ts.

import { openaiFetch } from "@/lib/llm/openai-fetch"

const SYSTEM_PROMPT = `Du er en erfaren norsk håndverker/entreprenør som svarer en kunde i en meldingstråd. Du skriver utkast til svar som bedriften kan se over, justere og godkjenne før det sendes.

Mål: et profesjonelt, vennlig og konkret svar som flytter samtalen videre.

Regler:
- Skriv på norsk (bokmål). Varmt, tydelig og respektfullt — som en fagperson til en kunde.
- Svar direkte på det kunden sist skrev. Hvis kunden stiller et spørsmål, besvar det så godt konteksten tillater.
- Hold deg KORT og konkret. Som regel 1–4 setninger. Korte avsnitt.
- ALDRI finn opp priser, datoer, mål, garantier eller forpliktelser som ikke finnes i tråden. Er noe uklart, foreslå et naturlig oppfølgingsspørsmål eller si at dere kommer tilbake med detaljer.
- Ikke bruk store løfter, hype, KUN STORE BOKSTAVER eller utropstegn-spamming.
- IKKE skriv signatur, navn, "Mvh", e-post eller telefonnummer — avsenderen legger til sin egen avslutning.
- Skriv kun selve meldingsteksten, ingen emnefelt og ingen hilsen som "Hei [navn]" med klammeparenteser. Du kan bruke kundens fornavn hvis det er naturlig.
- Svar KUN som JSON: { "suggestion": "..." }`

export type ThreadMessage = {
  /** Who wrote the message in the existing thread. */
  sender: "company" | "customer"
  content: string
}

type SuggestInput = {
  companyName?: string | null
  customerName?: string | null
  /** Recent thread messages in chronological order (oldest first). */
  thread: ThreadMessage[]
}

function normalizeJsonFromModel(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  }
  return trimmed
}

/** Render the thread as a readable transcript for the model. */
function buildTranscript(input: SuggestInput): string {
  const companyLabel = input.companyName?.trim() || "Bedriften"
  const customerLabel = input.customerName?.trim() || "Kunden"

  const lines = input.thread
    .filter((m) => m.content.trim())
    .map((m) => `${m.sender === "company" ? companyLabel : customerLabel}: ${m.content.trim()}`)

  if (lines.length === 0) {
    return `Det finnes ingen meldinger i tråden ennå. Skriv en kort, vennlig åpningsmelding fra ${companyLabel} til ${customerLabel}.`
  }

  return [
    `Meldingstråd mellom ${companyLabel} og ${customerLabel} (eldste først):`,
    "",
    ...lines,
    "",
    `Skriv et forslag til neste svar fra ${companyLabel}.`,
  ].join("\n")
}

export async function generateMessageReply(input: SuggestInput): Promise<{ suggestion: string }> {
  const response = await openaiFetch("chat/completions", {
    model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildTranscript(input) },
    ],
  })

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>
  }
  const raw = payload.choices?.[0]?.message?.content || "{}"
  const parsed = JSON.parse(normalizeJsonFromModel(raw)) as { suggestion?: string }

  const suggestion = (parsed.suggestion || "").trim()
  if (!suggestion) throw new Error("KI returnerte tomt forslag")

  return { suggestion }
}
