import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity, logSellerEmail } from "@/lib/selger/activity-log"
import { isOptedOut, sendOutreachEmail } from "@/lib/outreach/send"

const patchSchema = z.object({
  action: z.enum(["approve", "reject"]),
  subject: z.string().trim().min(1).max(300).optional(),
  body: z.string().trim().min(1).max(8000).optional(),
})

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: draft } = await admin
    .from("prospect_outreach")
    .select("id, status, ai_subject, ai_body, prospect_id, prospects(id, name, email, org_number, status)")
    .eq("id", id)
    .maybeSingle()

  if (!draft) return NextResponse.json({ error: "Fant ikke utkast" }, { status: 404 })

  const prospect = (Array.isArray(draft.prospects) ? draft.prospects[0] : draft.prospects) as
    | { id: string; name: string; email: string | null; org_number: string; status: string }
    | null
  if (!prospect) return NextResponse.json({ error: "Fant ikke prospekt" }, { status: 404 })

  // --- Reject ---
  if (parsed.data.action === "reject") {
    await admin.from("prospect_outreach").update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", id)
    return NextResponse.json({ ok: true, status: "rejected" })
  }

  // --- Approve & send ---
  if (!prospect.email) {
    return NextResponse.json({ error: "Prospektet mangler e-post" }, { status: 400 })
  }

  // Opt-out check (markedsføringsloven/GDPR).
  if (await isOptedOut(admin, { email: prospect.email, orgNumber: prospect.org_number })) {
    await admin
      .from("prospect_outreach")
      .update({ status: "unsubscribed", updated_at: new Date().toISOString() })
      .eq("id", id)
    return NextResponse.json({ ok: true, status: "unsubscribed", skipped: true })
  }

  const subject = parsed.data.subject ?? draft.ai_subject ?? ""
  const bodyText = parsed.data.body ?? draft.ai_body ?? ""
  const origin = new URL(request.url).origin
  const unsubscribeUrl = `${origin}/api/outreach/unsubscribe?p=${prospect.id}`

  let providerMessageId: string | null = null
  try {
    const sent = await sendOutreachEmail({ to: prospect.email, subject, body: bodyText, unsubscribeUrl })
    providerMessageId = sent.providerMessageId
  } catch (error) {
    console.error("[outreach/drafts approve] send failed", error)
    return NextResponse.json({ error: "Kunne ikke sende e-post" }, { status: 502 })
  }

  const now = new Date().toISOString()
  await admin
    .from("prospect_outreach")
    .update({
      status: "sent",
      ai_subject: subject,
      ai_body: bodyText,
      sent_at: now,
      approved_by: auth.user!.id,
      updated_at: now,
    })
    .eq("id", id)

  // Move prospect forward unless it's already further along.
  if (["ny", "kvalifisert"].includes(prospect.status)) {
    await admin
      .from("prospects")
      .update({ status: "kontaktet", last_contacted_at: now, updated_at: now })
      .eq("id", prospect.id)
  } else {
    await admin.from("prospects").update({ last_contacted_at: now, updated_at: now }).eq("id", prospect.id)
  }

  await logSellerEmail({
    sentBy: auth.user!.id,
    templateId: "outreach-cold",
    recipientEmail: prospect.email,
    companyId: null,
    providerMessageId,
  })
  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "send_email",
    targetType: "prospect",
    targetId: prospect.id,
    metadata: { companyName: prospect.name, kind: "outreach", recipientEmail: prospect.email },
  })

  return NextResponse.json({ ok: true, status: "sent" })
}
