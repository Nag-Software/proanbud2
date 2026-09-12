import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity, logSellerEmail } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { getOutreachFromAddress, getSendMode, plusAddress } from "@/lib/outreach/send"
import { Resend } from "resend"

export const maxDuration = 30

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

const schema = z.discriminatedUnion("action", [
  // Send Caspers svar i samme tråd.
  z.object({
    action: z.literal("send"),
    body: z.string().min(1).max(10000),
    subject: z.string().max(300).optional(),
  }),
  // Koble et ukjent svar til riktig prospekt.
  z.object({ action: z.literal("koble"), prospectId: z.string().uuid() }),
  z.object({ action: z.literal("behandlet") }),
])

type ReplyRow = {
  id: string
  prospect_id: string | null
  from_email: string
  subject: string | null
  message_id: string | null
  references: string | null
  handled_at: string | null
}

/**
 * Handlinger på ett innkommende svar.
 *
 * Svaret sendes herfra, ikke av maskinen. Fra det øyeblikket noen har svart er
 * det en samtale mellom to mennesker, og det eneste Proanbud egentlig har å
 * tilby en håndverker er at Casper svarer selv.
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
  const { data: reply } = await admin
    .from("inbound_emails")
    .select("id, prospect_id, from_email, subject, message_id, references, handled_at")
    .eq("id", id)
    .maybeSingle<ReplyRow>()

  if (!reply) return NextResponse.json({ error: "Fant ikke svaret" }, { status: 404 })

  const now = new Date().toISOString()

  if (parsed.data.action === "behandlet") {
    await admin
      .from("inbound_emails")
      .update({ handled_at: now, handled_by: auth.user!.id })
      .eq("id", id)
    return NextResponse.json({ ok: true })
  }

  if (parsed.data.action === "koble") {
    await admin
      .from("inbound_emails")
      .update({ prospect_id: parsed.data.prospectId, match_method: "manuell" })
      .eq("id", id)

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "link_reply",
      targetType: "prospect",
      targetId: parsed.data.prospectId,
      metadata: { replyId: id, fromEmail: reply.from_email },
    })

    return NextResponse.json({ ok: true, prospectId: parsed.data.prospectId })
  }

  // ── Send svar ─────────────────────────────────────────────────────────────
  if (!reply.prospect_id) {
    return NextResponse.json(
      { error: "Koble svaret til et lead først" },
      { status: 409 },
    )
  }

  const { data: prospect } = await admin
    .from("prospects")
    .select("id, name, tracking_token, matched_company_id")
    .eq("id", reply.prospect_id)
    .maybeSingle<{
      id: string
      name: string
      tracking_token: string | null
      matched_company_id: string | null
    }>()

  if (!prospect) return NextResponse.json({ error: "Fant ikke leadet" }, { status: 404 })

  // Tråding: samme emne med Re:, og In-Reply-To mot deres Message-ID.
  const baseSubject = (parsed.data.subject || reply.subject || "").replace(/^re:\s*/i, "")
  const subject = `Re: ${baseSubject}`.trim()

  const mode = getSendMode()

  try {
    let providerMessageId: string | null = null

    if (mode === "dry-run") {
      console.info(`[replies] dry-run: ville svart ${reply.from_email} — «${subject}»`)
    } else {
      const headers: Record<string, string> = {}
      if (reply.message_id) {
        headers["In-Reply-To"] = reply.message_id
        headers["References"] = [reply.references, reply.message_id].filter(Boolean).join(" ")
      }

      const { data, error } = await resend.emails.send({
        from: getOutreachFromAddress(),
        to: mode === "test" ? process.env.SALG_TEST_RECIPIENT || reply.from_email : reply.from_email,
        replyTo: prospect.tracking_token
          ? plusAddress(getOutreachFromAddress(), prospect.tracking_token)
          : undefined,
        subject,
        text: parsed.data.body,
        ...(Object.keys(headers).length > 0 ? { headers } : {}),
      })
      if (error) throw new Error(error.message ?? "Resend-feil")
      providerMessageId = data?.id ?? null
    }

    await admin
      .from("inbound_emails")
      .update({ handled_at: now, handled_by: auth.user!.id })
      .eq("id", id)

    if (mode !== "dry-run") {
      await logSellerEmail({
        sentBy: auth.user!.id,
        templateId: "selger-manual",
        recipientEmail: reply.from_email,
        companyId: prospect.matched_company_id,
        providerMessageId,
        prospectId: prospect.id,
        subject,
        body: parsed.data.body,
      })
    }

    await admin
      .from("prospects")
      .update({ last_contacted_at: now, last_activity_at: now, updated_at: now })
      .eq("id", prospect.id)

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "send_email",
      targetType: "prospect",
      targetId: prospect.id,
      metadata: { replyId: id, recipientEmail: reply.from_email, threaded: true },
    })

    return NextResponse.json({ ok: true, simulated: mode === "dry-run" })
  } catch (error) {
    await logServerError({
      message: "Svar på innkommende e-post feilet",
      error,
      source: "api",
      route: "PATCH /api/selger/replies/[id]",
      context: { replyId: id, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Sendingen feilet — prøv igjen" }, { status: 502 })
  }
}
