import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { runInitialOutreach } from "@/lib/outreach/initial-send"
import { runOutreachFollowups } from "@/lib/outreach/followup"
import { countOutreachSentToday, getOutreachDailyLimit } from "@/lib/outreach/send"

// Drafting + sending a full daily batch can take a while.
export const maxDuration = 300

// Daily, hands-off run of the whole outbound lead engine:
//   1. Send all due FOLLOW-UPS to prospects who haven't replied (warmer — run first).
//   2. Spend whatever's left of the daily cap on the first cold email to fresh prospects.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set
// in the project env. Without a matching secret the route is closed. Configure the
// schedule in vercel.json and set CRON_SECRET in the Vercel project settings.
async function run(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET ikke konfigurert" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const origin = new URL(request.url).origin
  const dailyLimit = getOutreachDailyLimit()

  const sentToday = await countOutreachSentToday(admin)
  let remaining = Math.max(0, dailyLimit - sentToday)

  const followups = await runOutreachFollowups(admin, {
    origin,
    sentByUserId: null,
    maxBatch: remaining,
  })
  remaining = Math.max(0, remaining - followups.sent)

  let initial = { sent: 0, skipped: 0, failed: 0 }
  if (remaining > 0) {
    try {
      initial = await runInitialOutreach(admin, { origin, sentByUserId: null, maxBatch: remaining })
    } catch (err) {
      console.error("[outreach/cron] initial send failed", err)
    }
  }

  await logSellerActivity({
    sellerUserId: null,
    action: "cron_outreach",
    targetType: "prospects",
    metadata: { followups, initial, dailyLimit, sentBefore: sentToday },
  })

  return NextResponse.json({ ok: true, followups, initial, dailyLimit, dailyRemaining: remaining })
}

// Vercel Cron triggers via GET; allow POST too for manual/secret-protected triggering.
export const GET = run
export const POST = run
