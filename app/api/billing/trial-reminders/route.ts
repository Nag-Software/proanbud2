import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { runTrialReminders } from "@/lib/billing/trial-reminders"

export const maxDuration = 120

// Daily, hands-off trial-conversion nudges. Emails trialing companies as their
// trial winds down (3 days / 1 day / just expired). Idempotent per template.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
// set. Configure the schedule in vercel.json.
async function run(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET ikke konfigurert" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const result = await runTrialReminders(admin)

  await logSellerActivity({
    sellerUserId: null,
    action: "cron_trial_reminders",
    targetType: "company_billing",
    metadata: result,
  })

  return NextResponse.json({ ok: true, ...result })
}

export const GET = run
export const POST = run
