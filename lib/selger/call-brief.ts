// AI call-brief — the 10-second prep a seller reads before dialing a hot lead.
// Returns who they are, our history with them, the angle for THIS call, and a
// suggested opener. Built from the prospect row + the outreach thread + engagement.
// Degrades to a deterministic brief when the LLM is unavailable.

import { openaiFetch } from "@/lib/llm/openai-fetch"
import { createAdminClient } from "@/lib/supabase/admin"
import { BRANSJE_LABELS, resolveBransje } from "@/lib/outreach/bransje"

export type CallBrief = {
  who: string
  history: string
  angle: string
  opener: string
}

function normalizeJsonFromModel(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return "{}"
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
  }
  return trimmed
}

type ProspectContext = {
  name: string
  city: string | null
  naceDescription: string | null
  naceCode: string | null
  employeeCount: number | null
  status: string
  openCount: number
  clickCount: number
  lastContactedAt: string | null
  steps: { subject: string | null; sentAt: string | null }[]
}

async function loadProspectContext(prospectId: string): Promise<ProspectContext | null> {
  const admin = createAdminClient()
  const { data: p } = await admin
    .from("prospects")
    .select(
      "name, city, nace_code, nace_description, employee_count, status, open_count, click_count, last_contacted_at"
    )
    .eq("id", prospectId)
    .maybeSingle()
  if (!p) return null

  const { data: steps } = await admin
    .from("prospect_outreach")
    .select("ai_subject, sent_at")
    .eq("prospect_id", prospectId)
    .eq("status", "sent")
    .order("sent_at", { ascending: true })
    .limit(5)

  return {
    name: p.name as string,
    city: (p.city as string | null) ?? null,
    naceDescription: (p.nace_description as string | null) ?? null,
    naceCode: (p.nace_code as string | null) ?? null,
    employeeCount: (p.employee_count as number | null) ?? null,
    status: (p.status as string) ?? "ny",
    openCount: (p.open_count as number | null) ?? 0,
    clickCount: (p.click_count as number | null) ?? 0,
    lastContactedAt: (p.last_contacted_at as string | null) ?? null,
    steps: (steps ?? []).map((s) => ({ subject: s.ai_subject as string | null, sentAt: s.sent_at as string | null })),
  }
}

function buildFallbackBrief(ctx: ProspectContext): CallBrief {
  const bransje = resolveBransje({ naceCode: ctx.naceCode, naceDescription: ctx.naceDescription })
  const label = BRANSJE_LABELS[bransje]
  const engagement =
    ctx.clickCount > 0
      ? `klikket i e-posten (${ctx.clickCount}×)`
      : ctx.openCount > 0
        ? `åpnet e-posten ${ctx.openCount}×`
        : "har fått e-post fra oss"
  return {
    who: `${ctx.name}${ctx.city ? ` i ${ctx.city}` : ""} — ${label}${
      ctx.employeeCount ? `, ${ctx.employeeCount} ansatte` : ""
    }.`,
    history: `Vi har sendt ${ctx.steps.length || 1} e-post(er); de ${engagement}.`,
    angle: "Vis hvor raskt de kan lage et proft tilbud med KI fra egne leverandørpriser, og tilby gratis prøveperiode.",
    opener: `Hei, det er Casper fra Proanbud — jeg så at du tittet på e-posten jeg sendte. Har du to minutter?`,
  }
}

export async function generateCallBrief(prospectId: string): Promise<CallBrief | null> {
  const ctx = await loadProspectContext(prospectId)
  if (!ctx) return null

  const fallback = buildFallbackBrief(ctx)
  if (!process.env.OPENAI_API_KEY) return fallback

  const bransje = resolveBransje({ naceCode: ctx.naceCode, naceDescription: ctx.naceDescription })

  try {
    const response = await openaiFetch(
      "chat/completions",
      {
        model: process.env.OPENAI_MODEL || "gpt-5.2-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              'Du er en norsk salgscoach. Lag en kort ringe-brief til en selger som skal ringe et varmt lead for Proanbud (KI-tilbud + prosjektstyring for bygg/anlegg). Norsk, konkret, ingen fyllord. Svar KUN som JSON: {"who":"...","history":"...","angle":"...","opener":"..."}. who=1 setning om hvem de er. history=1 setning om vår kontakt + engasjement. angle=hvilken vinkel som passer dette leadet nå. opener=én naturlig åpningssetning selgeren kan si.',
          },
          {
            role: "user",
            content: [
              `Bedrift: ${ctx.name}`,
              ctx.city ? `Sted: ${ctx.city}` : "",
              ctx.naceDescription ? `Bransje: ${ctx.naceDescription} (${BRANSJE_LABELS[bransje]})` : "",
              ctx.employeeCount ? `Ansatte: ${ctx.employeeCount}` : "",
              `CRM-status: ${ctx.status}`,
              `Åpnet e-post: ${ctx.openCount}× · Klikket: ${ctx.clickCount}×`,
              ctx.steps.length ? `Sendte e-poster: ${ctx.steps.map((s) => s.subject).filter(Boolean).join(" | ")}` : "Ingen sendt ennå",
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
      },
      { retries: 1, timeoutMs: 15000 }
    )

    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string | null } }> }
    const raw = payload.choices?.[0]?.message?.content
    if (!raw) return fallback
    const parsed = JSON.parse(normalizeJsonFromModel(raw)) as Partial<CallBrief>
    return {
      who: parsed.who?.trim() || fallback.who,
      history: parsed.history?.trim() || fallback.history,
      angle: parsed.angle?.trim() || fallback.angle,
      opener: parsed.opener?.trim() || fallback.opener,
    }
  } catch {
    return fallback
  }
}
