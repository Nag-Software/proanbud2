import { type OfferLineItem } from "@/lib/tilbud/types"

type GenerateProjectSummaryInput = {
  title: string
  description: string
  projectName?: string | null
  lineItems: OfferLineItem[]
}

function buildFallbackProjectSummary(input: GenerateProjectSummaryInput) {
  const subprojects = Array.from(new Set(input.lineItems.map((item) => item.subproject).filter(Boolean)))
  const scope =
    subprojects.length > 0
      ? subprojects.slice(0, 3).join(", ")
      : input.lineItems
          .slice(0, 3)
          .map((item) => item.title)
          .filter(Boolean)
          .join(", ")

  const projectLabel = input.projectName?.trim() || input.title.trim() || "prosjektet"
  if (scope) {
    return `Tilbud for ${projectLabel} med arbeider som blant annet omfatter ${scope}.`
  }

  const trimmed = input.description.trim()
  if (trimmed.length > 0) {
    return trimmed.length > 180 ? `${trimmed.slice(0, 177).trim()}…` : trimmed
  }

  return `Kort tilbud for ${projectLabel}.`
}

function normalizeJsonFromModel(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return "{}"

  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  }

  return trimmed
}

export function readProjectSummaryFromAnalysis(analysisResult: unknown) {
  if (!analysisResult || typeof analysisResult !== "object") return ""

  const summary = (analysisResult as Record<string, unknown>).summary
  return typeof summary === "string" ? summary.trim() : ""
}

export async function generateProjectSummary(input: GenerateProjectSummaryInput) {
  const fallback = buildFallbackProjectSummary(input)

  if (!process.env.OPENAI_API_KEY) {
    return fallback
  }

  const lineItemHints = input.lineItems
    .slice(0, 8)
    .map((item) => `${item.subproject}: ${item.title}`)
    .join("\n")

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Du skriver korte, profesjonelle prosjektbeskrivelser for norske håndverkertilbud. Svar alltid med JSON: {\"summary\":\"...\"}. Maks 2 korte setninger, maks 220 tegn.",
          },
          {
            role: "user",
            content: [
              `Prosjekt: ${input.projectName || input.title || "Ukjent"}`,
              `Tittel: ${input.title}`,
              `Jobbeskrivelse: ${input.description || "Ingen detaljert beskrivelse"}`,
              lineItemHints ? `Hovedposter:\n${lineItemHints}` : "",
            ]
              .filter(Boolean)
              .join("\n\n"),
          },
        ],
      }),
    })

    if (!response.ok) {
      return fallback
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (!content) {
      return fallback
    }

    const parsed = JSON.parse(normalizeJsonFromModel(content)) as { summary?: string }
    const summary = parsed.summary?.trim()
    if (!summary) {
      return fallback
    }

    return summary.length > 220 ? `${summary.slice(0, 217).trim()}…` : summary
  } catch {
    return fallback
  }
}

export function mergeAnalysisSummary(analysisResult: unknown, summary: string) {
  const base = analysisResult && typeof analysisResult === "object" ? { ...(analysisResult as Record<string, unknown>) } : {}
  return {
    ...base,
    summary,
    generatedAt: new Date().toISOString(),
  }
}
