import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity, logSellerEmail } from "@/lib/selger/activity-log"
import { generateOutreachDraft } from "@/lib/outreach/draft"
import { isOptedOut, sendOutreachEmail } from "@/lib/outreach/send"

// AI drafting + sending a batch can take a while.
export const maxDuration = 60

// Daily cap protects sender reputation even in full-auto.
const DAILY_LIMIT = Number(process.env.OUTREACH_DAILY_LIMIT) || 200

type EligibleProspect = {
  id: string
  org_number: string
  name: string
  email: string | null
  city: string | null
  nace_description: string | null
  employee_count: number | null
  status: string
}

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const body = (await request.json().catch(() => ({}))) as { limit?: number }
  const requested = Math.min(Math.max(body.limit ?? 25, 1), 50)
  const admin = createAdminClient()
  const origin = new URL(request.url).origin

  // Respect the daily send cap.
  const startOfDay = new Date()
  startOfDay.setUTCHours(0, 0, 0, 0)
  const { count: sentToday } = await admin
    .from("seller_email_log")
    .select("id", { count: "exact", head: true })
    .eq("template_id", "outreach-cold")
    .gte("created_at", startOfDay.toISOString())

  const remaining = Math.max(0, DAILY_LIMIT - (sentToday ?? 0))
  if (remaining === 0) {
    return NextResponse.json({
      sent: 0,
      skipped: 0,
      failed: 0,
      capReached: true,
      dailyLimit: DAILY_LIMIT,
    })
  }

  const batchLimit = Math.min(requested, remaining)

  // Eligible = has email, not yet contacted (status ny/kvalifisert), not a customer.
  const { data: prospects, error } = await admin
    .from("prospects")
    .select("id, org_number, name, email, city, nace_description, employee_count, status")
    .not("email", "is", null)
    .eq("is_existing_customer", false)
    .in("status", ["ny", "kvalifisert"])
    .order("created_at", { ascending: true })
    .limit(batchLimit)

  if (error) {
    console.error("[outreach/auto-send] load failed", error)
    return NextResponse.json({ error: "Kunne ikke hente prospekter" }, { status: 500 })
  }

  const rows = (prospects ?? []) as EligibleProspect[]
  let sent = 0
  let skipped = 0
  let failed = 0

  async function processOne(p: EligibleProspect) {
    if (!p.email) {
      skipped += 1
      return
    }
    try {
      if (await isOptedOut(admin, { email: p.email, orgNumber: p.org_number })) {
        skipped += 1
        await admin.from("prospects").update({ status: "avvist", updated_at: new Date().toISOString() }).eq("id", p.id)
        return
      }

      const draft = await generateOutreachDraft({
        name: p.name,
        city: p.city,
        naceDescription: p.nace_description,
        employeeCount: p.employee_count,
      })

      const unsubscribeUrl = `${origin}/api/outreach/unsubscribe?p=${p.id}`
      await sendOutreachEmail({ to: p.email, subject: draft.subject, body: draft.body, unsubscribeUrl })

      const now = new Date().toISOString()
      await admin.from("prospect_outreach").insert({
        prospect_id: p.id,
        channel: "email",
        step_index: 0,
        status: "sent",
        ai_subject: draft.subject,
        ai_body: draft.body,
        sent_at: now,
        approved_by: auth.user!.id,
      })
      await admin
        .from("prospects")
        .update({ status: "kontaktet", last_contacted_at: now, updated_at: now })
        .eq("id", p.id)

      await logSellerEmail({
        sentBy: auth.user!.id,
        templateId: "outreach-cold",
        recipientEmail: p.email,
        companyId: null,
      })
      sent += 1
    } catch (err) {
      console.error("[outreach/auto-send] failed for", p.id, err)
      failed += 1
    }
  }

  // Bounded concurrency to be gentle on OpenAI/Resend.
  for (let i = 0; i < rows.length; i += 5) {
    await Promise.all(rows.slice(i, i + 5).map(processOne))
  }

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "auto_send_outreach",
    targetType: "prospects",
    metadata: { sent, skipped, failed, batchLimit, dailyLimit: DAILY_LIMIT },
  })

  return NextResponse.json({
    sent,
    skipped,
    failed,
    capReached: false,
    dailyRemaining: Math.max(0, remaining - sent),
    dailyLimit: DAILY_LIMIT,
  })
}
