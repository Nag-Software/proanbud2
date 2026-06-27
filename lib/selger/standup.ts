// Daily AI "standup" — one Norwegian sentence at the top of "I dag" that tells the
// seller what the machine did in the last 24h and what needs them now. Degrades
// gracefully to a deterministic sentence when the LLM is unavailable (same pattern
// as lib/tilbud/project-summary.ts).

import { openaiFetch } from "@/lib/llm/openai-fetch"
import { logServerError } from "@/lib/errors/log"
import type { OutreachMetrics } from "@/lib/outreach/metrics"
import type { QueueCounts } from "@/lib/selger/queue"

function normalizeJsonFromModel(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return "{}"
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  }
  return trimmed
}

export function buildFallbackStandup(metrics: OutreachMetrics, counts: QueueCounts): string {
  const parts: string[] = []
  parts.push(`Maskinen sendte ${metrics.sentToday} e-poster i dag`)
  if (metrics.openRate > 0) parts.push(`${(metrics.openRate * 100).toFixed(0)} % åpningsrate`)

  const todo: string[] = []
  if (counts.call > 0) todo.push(`${counts.call} varme å ringe`)
  if (counts.approve > 0) todo.push(`${counts.approve} utkast å godkjenne`)
  if (counts.trial > 0) todo.push(`${counts.trial} trial som utløper`)

  const lead = parts.join(", ")
  if (todo.length === 0) {
    return `${lead}. Ingenting venter på deg — maskinen har kontroll.`
  }
  return `${lead}. Du har ${todo.join(", ")}.`
}

export async function generateStandup(metrics: OutreachMetrics, counts: QueueCounts): Promise<string> {
  const fallback = buildFallbackStandup(metrics, counts)
  if (!process.env.OPENAI_API_KEY) return fallback

  try {
    const response = await openaiFetch(
      "chat/completions",
      {
        model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Du er en skarp salgssjef som gir selgeren en kort morgenbrief på norsk. ÉN setning, maks 30 ord, konkret og motiverende — ikke svulstig. Start med hva maskinen gjorde, så hva selgeren bør gjøre nå. Svar KUN som JSON: {"standup":"..."}',
          },
          {
            role: "user",
            content: [
              `Sendt i dag: ${metrics.sentToday}`,
              `Sendt siste 7 dager: ${metrics.sent7d}`,
              `Åpningsrate 30d: ${(metrics.openRate * 100).toFixed(0)} %`,
              `Klikkrate 30d: ${(metrics.clickRate * 100).toFixed(0)} %`,
              `Konverteringer totalt: ${metrics.conversions}`,
              `Varme leads å ringe: ${counts.call}`,
              `Utkast å godkjenne: ${counts.approve}`,
              `Trials som utløper snart: ${counts.trial}`,
            ].join("\n"),
          },
        ],
      },
      { retries: 1, timeoutMs: 12000 }
    )

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> }
    const raw = payload.choices?.[0]?.message?.content
    if (!raw) return fallback
    const parsed = JSON.parse(normalizeJsonFromModel(raw)) as { standup?: string }
    const out = parsed.standup?.trim()
    return out && out.length > 0 ? out : fallback
  } catch (error) {
    // Best-effort: the deterministic fallback is still returned to the caller.
    await logServerError({
      message: "generateStandup: KI-standup feilet, bruker fallback",
      error,
      level: "warning",
      source: "server",
      route: "generateStandup",
    })
    return fallback
  }
}
