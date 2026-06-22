import { NextResponse } from "next/server"
import { Webhook } from "svix"

import { createAdminClient } from "@/lib/supabase/admin"

export const runtime = "nodejs"

// Resend bounce/complaint webhook. Hard bounces and spam complaints are added to
// the outreach suppress list (outreach_unsubscribes) so isOptedOut() blocks all
// future cold sends — otherwise we keep mailing dead/complaining addresses and
// burn the sender domain's reputation.
//
// Prod setup: create the webhook in the Resend dashboard pointing at this route,
// subscribe to email.bounced + email.complained, and set RESEND_WEBHOOK_SECRET.

type ResendEvent = {
  type?: string
  data?: {
    to?: string[] | string
    email?: string
    bounce?: { type?: string; subType?: string }
  }
}

function firstRecipient(data: ResendEvent["data"]): string | null {
  if (!data) return null
  const raw = Array.isArray(data.to) ? data.to[0] : data.to ?? data.email
  return raw ? raw.trim().toLowerCase() || null : null
}

export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ ok: false, error: "Resend webhook not configured" }, { status: 500 })
  }

  const rawBody = await request.text()
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  }

  let event: ResendEvent
  try {
    event = new Webhook(secret).verify(rawBody, headers) as ResendEvent
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 })
  }

  const isComplaint = event.type === "email.complained"
  const isHardBounce =
    event.type === "email.bounced" &&
    ["permanent", "hardbounce", "hard_bounce"].includes((event.data?.bounce?.type || "").toLowerCase())

  // Ignore transient bounces, deliveries, opens, etc.
  if (!isComplaint && !isHardBounce) {
    return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" })
  }

  const email = firstRecipient(event.data)
  if (!email) {
    return NextResponse.json({ ok: true, ignored: "no-recipient" })
  }

  const admin = createAdminClient()
  const reason = isComplaint ? "complaint" : "bounce"

  await admin
    .from("outreach_unsubscribes")
    .upsert({ email, org_number: null, reason }, { onConflict: "email", ignoreDuplicates: true })

  // Best-effort: mark the matching prospects' outreach rows as bounced.
  const { data: prospects } = await admin.from("prospects").select("id").eq("email", email)
  const prospectIds = (prospects ?? []).map((p) => p.id)
  if (prospectIds.length > 0) {
    await admin
      .from("prospect_outreach")
      .update({ status: "bounced", updated_at: new Date().toISOString() })
      .in("prospect_id", prospectIds)
      .in("status", ["sent", "approved", "queued", "awaiting_approval"])
  }

  return NextResponse.json({ ok: true, suppressed: email, reason })
}
