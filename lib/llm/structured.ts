// Strukturerte LLM-kall: Responses API + json_schema + parse + kostnad.
//
// Erstatter de fire kopiene av `normalizeJsonFromModel` med ett sted som
// faktisk tvinger fram gyldig JSON (strict json_schema), i stedet for å be
// pent om det i prompten og rydde opp i ```-gjerder etterpå.
//
// Kostnaden regnes ut per kall, slik at «kostnad per kvalifisert lead» i
// Analyse er et målt tall og ikke et estimat.

import { openaiFetch } from "@/lib/llm/openai-fetch"

export type TokenUsage = {
  tokens_in: number
  tokens_out: number
  cost_usd: number
  model: string
}

export type StructuredResult<T> = {
  ok: true
  data: T
  usage: TokenUsage
}

export type StructuredError = {
  ok: false
  error: string
  usage: TokenUsage | null
}

/** USD per million tokens. Ukjente modeller faller tilbake på mini-prisen. */
const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5.2": { input: 1.25, output: 10 },
  "gpt-5.2-mini": { input: 0.25, output: 2 },
  "gpt-5.2-nano": { input: 0.05, output: 0.4 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-5.1-mini": { input: 0.25, output: 2 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5": { input: 1.25, output: 10 },
}

export function priceFor(model: string, tokensIn: number, tokensOut: number): number {
  const key =
    Object.keys(PRICING)
      .sort((a, b) => b.length - a.length)
      .find((candidate) => model.startsWith(candidate)) || "gpt-5.2-mini"
  const rate = PRICING[key]
  return (tokensIn * rate.input + tokensOut * rate.output) / 1_000_000
}

export type StructuredRequest = {
  model?: string
  /** Navn på skjemaet — vises i feilmeldinger fra OpenAI. */
  schemaName: string
  /** JSON Schema. Må være strict-kompatibelt: alle felt i `required`,
   *  `additionalProperties: false` på hvert objekt. */
  schema: Record<string, unknown>
  system: string
  user: string
  maxOutputTokens?: number
  timeoutMs?: number
  /** Kalles med et lavere `reasoning.effort` når svaret må komme raskt. */
  effort?: "low" | "medium" | "high"
}

type ResponsesPayload = {
  output_text?: string
  output?: Array<{
    type?: string
    content?: Array<{ type?: string; text?: string }>
  }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** Plukker teksten ut av et Responses-svar, uansett hvilken form det har. */
function textFrom(payload: ResponsesPayload): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text
  }
  const parts: string[] = []
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") parts.push(content.text)
    }
  }
  return parts.join("")
}

export function defaultModel(): string {
  return process.env.OPENAI_MODEL || "gpt-5.2-mini"
}

/**
 * Ett strukturert kall. Kaster aldri på modellfeil — kallstedet får
 * `{ ok: false }` og bestemmer selv hva som skal skje, fordi en feilet
 * research aldri skal velte en hel tick.
 */
export async function structuredCall<T>(
  request: StructuredRequest,
  validate: (value: unknown) => T,
): Promise<StructuredResult<T> | StructuredError> {
  const model = request.model || defaultModel()
  let usage: TokenUsage | null = null

  try {
    const response = await openaiFetch(
      "responses",
      {
        model,
        input: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            strict: true,
            schema: request.schema,
          },
        },
        ...(request.maxOutputTokens ? { max_output_tokens: request.maxOutputTokens } : {}),
        ...(request.effort ? { reasoning: { effort: request.effort } } : {}),
      },
      { timeoutMs: request.timeoutMs ?? 60000 },
    )

    const payload = (await response.json()) as ResponsesPayload
    const tokensIn = payload.usage?.input_tokens ?? 0
    const tokensOut = payload.usage?.output_tokens ?? 0
    usage = {
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: priceFor(model, tokensIn, tokensOut),
      model,
    }

    const raw = textFrom(payload).trim()
    if (!raw) return { ok: false, error: "Tomt svar fra modellen", usage }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { ok: false, error: "Svaret var ikke gyldig JSON", usage }
    }

    return { ok: true, data: validate(parsed), usage }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Ukjent feil fra modellen",
      usage,
    }
  }
}

// ── Små hjelpere for å lese utrygg JSON ─────────────────────────────────────

export function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback
}
