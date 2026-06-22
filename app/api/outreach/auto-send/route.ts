import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { runInitialOutreach } from "@/lib/outreach/initial-send"
import { countOutreachSentToday, getOutreachDailyLimit } from "@/lib/outreach/send"

// AI drafting + sending a batch can take a while.
export const maxDuration = 60

export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const body = (await request.json().catch(() => ({}))) as { limit?: number }
  const requested = Math.min(Math.max(body.limit ?? 25, 1), 50)
  const admin = createAdminClient()
  const origin = new URL(request.url).origin
  const dailyLimit = getOutreachDailyLimit()

  // Respect the daily send cap (shared by cold + follow-up emails).
  const sentToday = await countOutreachSentToday(admin)
  const remaining = Math.max(0, dailyLimit - sentToday)
  if (remaining === 0) {
    return NextResponse.json({ sent: 0, skipped: 0, failed: 0, capReached: true, dailyLimit })
  }

  const batchLimit = Math.min(requested, remaining)
  let runError = false
  let result = { sent: 0, skipped: 0, failed: 0 }
  try {
    result = await runInitialOutreach(admin, {
      origin,
      sentByUserId: auth.user!.id,
      maxBatch: batchLimit,
    })
  } catch (err) {
    console.error("[outreach/auto-send] run failed", err)
    runError = true
  }

  if (runError) {
    return NextResponse.json({ error: "Kunne ikke hente prospekter" }, { status: 500 })
  }

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "auto_send_outreach",
    targetType: "prospects",
    metadata: { ...result, batchLimit, dailyLimit },
  })

  return NextResponse.json({
    ...result,
    capReached: false,
    dailyRemaining: Math.max(0, remaining - result.sent),
    dailyLimit,
  })
}
