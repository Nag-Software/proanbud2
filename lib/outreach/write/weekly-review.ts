// Ukentlig gjennomgang av redigeringsmønstre.
//
// Casper redigerer uansett. Det som er bortkastet, er at han redigerer bort
// den samme setningen tretti ganger uten at noen endrer prompten. Denne
// modulen leser KI-originalen mot hans endelige tekst og ber en modell om å
// finne mønsteret.
//
// Forslagene tas ALDRI i bruk automatisk. De vises i Analyse, og Casper
// bestemmer. En maskin som skriver om sine egne instrukser basert på sin egen
// vurdering av sine egne resultater har ingen utenforstående korreksjon igjen.

import { asArray, asRecord, asString, structuredCall } from "@/lib/llm/structured"
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { editRatio, REJECT_REASON_LABELS, type RejectReason } from "@/lib/outreach/write/learning"

export type ReviewSuggestion = {
  /** Hva modellen mener den ser. */
  pattern: string
  /** Konkret forslag til endring i prompten eller playbooken. */
  suggestion: string
  /** Hvor mange av eksemplene som peker samme vei. */
  seen_in: number
}

export type WeeklyReview = {
  generated_at: string
  sampled: number
  median_edit: number | null
  top_rejections: Array<{ reason: RejectReason; label: string; count: number }>
  suggestions: ReviewSuggestion[]
  summary: string
  cost_usd: number
}

const SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["oppsummering", "funn"],
  properties: {
    oppsummering: {
      type: "string",
      description: "To til tre setninger om hva som går igjen i redigeringene.",
    },
    funn: {
      type: "array",
      description: "Opptil fem mønstre. Tom liste hvis du ikke ser noe tydelig.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["monster", "forslag", "antall"],
        properties: {
          monster: { type: "string", description: "Hva han konsekvent endrer." },
          forslag: {
            type: "string",
            description: "Konkret endring i instruksen til skriveren. Én setning.",
          },
          antall: { type: "integer", description: "Hvor mange av eksemplene som viser dette." },
        },
      },
    },
  },
}

const SYSTEM = `Du analyserer hvordan en selger redigerer KI-skrevne e-poster før han sender dem.

Du får par av (KI-original, endelig tekst) og avvisningsgrunner. Oppgaven er å finne MØNSTRE — ikke å kommentere enkelttilfeller.

Regler:
- Ser du ikke et tydelig mønster, si det. En tom liste er et gyldig svar, og bedre enn oppdiktede funn.
- Et mønster krever minst tre eksempler som peker samme vei.
- Forslagene skal være noe som kan stå i en instruks: «slutt å åpne med X», «hold andre avsnitt til én setning».
- Ikke foreslå noe som bryter faktabrannmuren eller lovkravene (organisasjonsform, avmelding, maks tre meldinger).
- Skriv på norsk.`

type Pair = {
  ai: string
  final: string
  ratio: number
}

/**
 * Leser de siste avgjørelsene og ber om en gjennomgang.
 *
 * Trenger minst ti redigerte e-poster for å si noe — under det er «mønsteret»
 * bare tilfeldigheter.
 */
export async function generateWeeklyReview(segment = "handverker"): Promise<WeeklyReview | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("outreach_messages")
      .select("body_ai, body_final, status, reject_reason, prospects!inner(segment)")
      .eq("prospects.segment", segment)
      .eq("step", 1)
      .in("status", ["godkjent", "planlagt", "sendt", "avvist"])
      .order("approved_at", { ascending: false, nullsFirst: false })
      .limit(60)

    if (error || !data) return null

    const rows = data as unknown as Array<{
      body_ai: string
      body_final: string | null
      status: string
      reject_reason: string | null
    }>

    const pairs: Pair[] = rows
      .filter((row) => row.status !== "avvist" && row.body_final && row.body_final !== row.body_ai)
      .map((row) => ({
        ai: row.body_ai,
        final: row.body_final!,
        ratio: editRatio(row.body_ai, row.body_final!),
      }))

    const rejectionCounts = new Map<RejectReason, number>()
    for (const row of rows) {
      if (row.status !== "avvist" || !row.reject_reason) continue
      const reason = row.reject_reason as RejectReason
      rejectionCounts.set(reason, (rejectionCounts.get(reason) ?? 0) + 1)
    }

    const topRejections = [...rejectionCounts.entries()]
      .map(([reason, count]) => ({
        reason,
        label: REJECT_REASON_LABELS[reason] ?? reason,
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4)

    const ratios = pairs.map((pair) => pair.ratio).sort((a, b) => a - b)
    const medianEdit =
      ratios.length === 0
        ? null
        : ratios.length % 2 === 0
          ? (ratios[ratios.length / 2 - 1] + ratios[ratios.length / 2]) / 2
          : ratios[Math.floor(ratios.length / 2)]

    // Under ti redigeringer er «mønsteret» bare tilfeldigheter.
    if (pairs.length < 10) {
      return {
        generated_at: new Date().toISOString(),
        sampled: pairs.length,
        median_edit: medianEdit,
        top_rejections: topRejections,
        suggestions: [],
        summary: `Bare ${pairs.length} redigerte e-poster så langt. Trenger minst ti før det er noe å lese ut av.`,
        cost_usd: 0,
      }
    }

    const examples = pairs
      .slice(0, 15)
      .map(
        (pair, index) =>
          `── Eksempel ${index + 1} (endret ${Math.round(pair.ratio * 100)} %) ──\nKI skrev:\n${pair.ai}\n\nCasper sendte:\n${pair.final}`,
      )
      .join("\n\n")

    const rejectionText =
      topRejections.length > 0
        ? `\n\nAvvisningsgrunner i samme periode:\n${topRejections
            .map((rejection) => `- ${rejection.label}: ${rejection.count}`)
            .join("\n")}`
        : ""

    const result = await structuredCall(
      {
        schemaName: "ukesgjennomgang",
        schema: SCHEMA,
        system: SYSTEM,
        user: `${examples}${rejectionText}`,
        maxOutputTokens: 1200,
        timeoutMs: 60000,
      },
      (value) => {
        const root = asRecord(value)
        return {
          summary: asString(root.oppsummering),
          suggestions: asArray(root.funn)
            .map((item) => {
              const finding = asRecord(item)
              return {
                pattern: asString(finding.monster),
                suggestion: asString(finding.forslag),
                seen_in: typeof finding.antall === "number" ? finding.antall : 0,
              }
            })
            .filter((finding) => finding.pattern && finding.suggestion)
            .slice(0, 5),
        }
      },
    )

    if (!result.ok) return null

    return {
      generated_at: new Date().toISOString(),
      sampled: pairs.length,
      median_edit: medianEdit,
      top_rejections: topRejections,
      suggestions: result.data.suggestions,
      summary: result.data.summary,
      cost_usd: result.usage.cost_usd,
    }
  } catch (error) {
    void logServerError({
      message: "Ukesgjennomgang feilet",
      level: "warning",
      source: "worker",
      error,
      context: { segment },
    })
    return null
  }
}
