import { NextResponse } from "next/server"
import { Webhook } from "svix"

import { createAdminClient } from "@/lib/supabase/admin"
import { computeLeadScore } from "@/lib/selger/scoring"
import { recordUnsubscribe } from "@/lib/outreach/send"
import { logServerError } from "@/lib/errors/log"

export const runtime = "nodejs"

// Resend engagement + suppression webhook.
//   • Hard bounces and spam complaints are added to the outreach suppress list
//     (outreach_unsubscribes) so isOptedOut() blocks all future cold sends —
//     otherwise we keep mailing dead/complaining addresses and burn the sender
//     domain's reputation.
//   • delivered / opened / clicked events are stamped onto seller_email_log (by
//     Resend message id) so the outreach dashboard can show what's actually
//     working — open rate, click rate, delivery rate.
//
// Prod setup: create the webhook in the Resend dashboard pointing at this route,
// subscribe to email.delivered + email.opened + email.clicked + email.bounced +
// email.complained, enable open/click tracking on the sending domain, and set
// RESEND_WEBHOOK_SECRET.

type ResendEvent = {
  type?: string
  data?: {
    to?: string[] | string
    email?: string
    email_id?: string
    id?: string
    bounce?: { type?: string; subType?: string }
  }
}

function firstRecipient(data: ResendEvent["data"]): string | null {
  if (!data) return null
  const raw = Array.isArray(data.to) ? data.to[0] : data.to ?? data.email
  return raw ? raw.trim().toLowerCase() || null : null
}

function messageId(data: ResendEvent["data"]): string | null {
  return data?.email_id ?? data?.id ?? null
}

/** Stamp an engagement timestamp onto the matching seller_email_log row. */
async function stampEmailEvent(
  admin: ReturnType<typeof createAdminClient>,
  providerMessageId: string,
  column: "delivered_at" | "opened_at" | "clicked_at" | "bounced_at" | "complained_at"
) {
  const now = new Date().toISOString()
  await admin
    .from("seller_email_log")
    .update({ [column]: now, last_event_at: now })
    .eq("provider_message_id", providerMessageId)
    // Don't overwrite the first occurrence — keep the earliest open/click time.
    .is(column, null)
}

/** Resolve the recipient: prefer the event payload, fall back to the logged row. */
async function resolveRecipient(
  admin: ReturnType<typeof createAdminClient>,
  event: ResendEvent,
  provider: string | null
): Promise<string | null> {
  const fromEvent = firstRecipient(event.data)
  if (fromEvent) return fromEvent
  if (!provider) return null
  const { data } = await admin
    .from("seller_email_log")
    .select("recipient_email")
    .eq("provider_message_id", provider)
    .maybeSingle()
  return data?.recipient_email ?? null
}

type EngagedProspect = {
  id: string
  open_count: number
  click_count: number
  status: string
  nace_code: string | null
  nace_description: string | null
  employee_count: number | null
  email: string | null
  last_contacted_at: string | null
}

/**
 * An open/click is the warmest signal we get. The counter increment, is_hot flag and
 * hot_since stamp happen atomically in the DB (bump_prospect_engagement, db/41) so
 * concurrent events never lose increments. We then recompute the derived lead_score
 * (which needs NACE→bransje mapping) in app code. No-op if the recipient isn't a
 * prospect.
 */
async function bumpProspectEngagement(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
  kind: "open" | "click"
) {
  const { data, error } = await admin.rpc("bump_prospect_engagement", {
    p_email: email.trim().toLowerCase(),
    p_kind: kind,
  })
  if (error) {
    console.error("[resend webhook] bump_prospect_engagement failed", error)
    await logServerError({
      message: "bump_prospect_engagement RPC failed",
      error,
      source: "api",
      route: "POST /api/webhooks/resend",
      context: { kind },
    })
    return
  }
  const prospect = (data as EngagedProspect[] | null)?.[0]
  if (!prospect) return // recipient isn't a prospect — nothing to score

  const { score, reasons } = computeLeadScore({
    naceCode: prospect.nace_code,
    naceDescription: prospect.nace_description,
    employeeCount: prospect.employee_count,
    email: prospect.email,
    status: prospect.status,
    openCount: prospect.open_count,
    clickCount: prospect.click_count,
    lastContactedAt: prospect.last_contacted_at,
  })

  await admin
    .from("prospects")
    .update({ lead_score: score, lead_score_reason: reasons })
    .eq("id", prospect.id)
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

  const admin = createAdminClient()
  const provider = messageId(event.data)

  // Engagement events: stamp the log row (delivery/open/click rates) AND, for
  // opens/clicks, warm up the prospect so hot leads surface in the seller cockpit.
  if (provider) {
    if (event.type === "email.delivered") {
      await stampEmailEvent(admin, provider, "delivered_at")
      return NextResponse.json({ ok: true, event: "delivered" })
    }
    if (event.type === "email.opened" || event.type === "email.clicked") {
      const kind = event.type === "email.opened" ? "open" : "click"
      await stampEmailEvent(admin, provider, kind === "open" ? "opened_at" : "clicked_at")
      const recipient = await resolveRecipient(admin, event, provider)
      if (recipient) {
        await bumpProspectEngagement(admin, recipient, kind)
      } else {
        console.warn(`[resend webhook] ${kind} event without resolvable recipient (provider=${provider})`)
      }
      return NextResponse.json({ ok: true, event: kind })
    }
  }

  const isComplaint = event.type === "email.complained"
  const isHardBounce =
    event.type === "email.bounced" &&
    ["permanent", "hardbounce", "hard_bounce"].includes((event.data?.bounce?.type || "").toLowerCase())

  // Ignore transient bounces, sends, etc. that aren't suppression-worthy.
  if (!isComplaint && !isHardBounce) {
    return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" })
  }

  const email = firstRecipient(event.data)
  if (!email) {
    return NextResponse.json({ ok: true, ignored: "no-recipient" })
  }

  const reason = isComplaint ? "complaint" : "bounce"

  // Stamp the engagement column too, so the dashboard's bounce/complaint rate is accurate.
  if (provider) {
    await stampEmailEvent(admin, provider, isComplaint ? "complained_at" : "bounced_at")
  }

  await recordUnsubscribe(admin, { email, orgNumber: null, reason })

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
