import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { dispatchMessage } from "@/lib/outreach/dispatch"
import type { Hook } from "@/lib/outreach/research/synthesize"
import { editRatio, isRejectReason } from "@/lib/outreach/write/learning"
import { lintMessage } from "@/lib/outreach/write/lint"

// Godkjenning sender med én gang i fase 1 — det inkluderer et MX-oppslag og
// et Resend-kall.
export const maxDuration = 60

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("godkjenn"),
    /** Caspers endelige tekst. Utelatt = KI-teksten godkjennes uendret. */
    subject: z.string().min(1).max(300).optional(),
    body: z.string().min(1).max(10000).optional(),
  }),
  z.object({
    action: z.literal("avvis"),
    reason: z.string().min(1).max(40),
    note: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal("hopp_over") }),
])

type MessageRow = {
  id: string
  prospect_id: string
  research_id: string | null
  step: number
  subject: string
  body_ai: string
  body_final: string | null
  hook_id: string | null
  status: string
}

/**
 * Godkjenn, rediger eller avvis ett utkast.
 *
 * Alt Casper gjør her er treningsdata: KI-originalen ligger urørt i `body_ai`,
 * hans versjon i `body_final`, redigeringsavstanden i `edit_ratio` og
 * avvisningsgrunnen i `reject_reason`. Det er grunnlaget for at maskinen skal
 * skrive bedre neste uke — og for å avgjøre om autopilot noen gang er fortjent.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: message } = await admin
    .from("outreach_messages")
    .select("id, prospect_id, research_id, step, subject, body_ai, body_final, hook_id, status")
    .eq("id", id)
    .maybeSingle<MessageRow>()

  if (!message) return NextResponse.json({ error: "Fant ikke utkastet" }, { status: 404 })
  if (message.status === "sendt") {
    return NextResponse.json({ error: "Meldingen er allerede sendt" }, { status: 409 })
  }

  const now = new Date().toISOString()

  // ── Avvis ─────────────────────────────────────────────────────────────────
  if (parsed.data.action === "avvis") {
    if (!isRejectReason(parsed.data.reason)) {
      return NextResponse.json({ error: "Ukjent avvisningsgrunn" }, { status: 400 })
    }

    await admin
      .from("outreach_messages")
      .update({
        status: "avvist",
        reject_reason: parsed.data.reason,
        reject_note: parsed.data.note ?? null,
        approved_by: auth.user!.id,
        approved_at: now,
      })
      .eq("id", id)

    // Prospektet går tilbake til «trenger deg»-lista, ikke ut av pipelinen —
    // et dårlig utkast betyr ikke at firmaet er feil.
    await admin
      .from("prospects")
      .update({ pipeline_state: "for_tynn" })
      .eq("id", message.prospect_id)
      .eq("pipeline_state", "til_godkjenning")

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "reject_draft",
      targetType: "prospect",
      targetId: message.prospect_id,
      metadata: { messageId: id, reason: parsed.data.reason, step: message.step },
    })

    return NextResponse.json({ ok: true, status: "avvist" })
  }

  // ── Hopp over ─────────────────────────────────────────────────────────────
  // Ingen dom felt — utkastet blir liggende, men havner bakerst i køen.
  if (parsed.data.action === "hopp_over") {
    await admin.from("outreach_messages").update({ updated_at: now }).eq("id", id)
    return NextResponse.json({ ok: true, status: message.status })
  }

  // ── Godkjenn (og send) ────────────────────────────────────────────────────
  const subject = parsed.data.subject?.trim() || message.subject
  const body = parsed.data.body?.trim() || message.body_ai
  const edited = body !== message.body_ai || subject !== message.subject

  // Caspers redigering går ikke utenom faktabrannmuren. Har han skrevet inn et
  // tall uten dekning eller en forbudt påstand, skal det stoppes her også.
  if (edited) {
    const hook = await loadHook(admin, message)
    const lint = lintMessage({
      subject,
      body,
      step: message.step,
      hook,
      allowLink: message.step > 1,
    })
    const blocking = lint.issues.filter((issue) => issue.severity === "blokkerende")
    if (blocking.length > 0) {
      return NextResponse.json(
        {
          error: "Den redigerte teksten bryter reglene",
          issues: blocking.map((issue) => issue.message),
        },
        { status: 422 },
      )
    }
  }

  await admin
    .from("outreach_messages")
    .update({
      subject,
      body_final: edited ? body : null,
      edit_ratio: edited ? Number(editRatio(message.body_ai, body).toFixed(4)) : 0,
      status: "godkjent",
      approved_by: auth.user!.id,
      approved_at: now,
      scheduled_for: now,
    })
    .eq("id", id)

  try {
    const sent = await dispatchMessage(id, { sentBy: auth.user!.id })

    if (!sent.ok) {
      return NextResponse.json(
        { ok: false, status: "godkjent", sendError: sent.message, code: sent.code },
        { status: sent.retryable ? 202 : 409 },
      )
    }

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "approve_draft",
      targetType: "prospect",
      targetId: message.prospect_id,
      metadata: { messageId: id, step: message.step, edited, simulated: sent.simulated },
    })

    return NextResponse.json({ ok: true, status: "sendt", simulated: sent.simulated, to: sent.to })
  } catch (error) {
    await logServerError({
      message: "Godkjenning av utkast feilet",
      error,
      source: "api",
      route: "PATCH /api/selger/messages/[id]",
      context: { messageId: id, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Sendingen feilet — prøv igjen" }, { status: 502 })
  }
}

/** Kroken utkastet ble bygget på, så lint kan sjekke første setning på nytt. */
async function loadHook(
  admin: ReturnType<typeof createAdminClient>,
  message: MessageRow,
): Promise<Hook | null> {
  if (!message.research_id || !message.hook_id) return null
  const { data } = await admin
    .from("prospect_research")
    .select("hooks")
    .eq("id", message.research_id)
    .maybeSingle<{ hooks: Hook[] | null }>()
  return data?.hooks?.find((hook) => hook.id === message.hook_id) ?? null
}
