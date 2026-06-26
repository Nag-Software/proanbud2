import { NextResponse } from "next/server"

import { runBillingReconcile } from "@/lib/billing/reconcile"
import { logSellerActivity } from "@/lib/selger/activity-log"

export const runtime = "nodejs"
export const maxDuration = 300

// Daily billing↔Stripe reconciliation. Heals rows left stale by missed webhooks
// (manual subscription deletion, trial-end without card, silent period rollover).
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Schedule in
// vercel.json.
async function run(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET ikke konfigurert" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runBillingReconcile()

  await logSellerActivity({
    sellerUserId: null,
    action: "cron_billing_reconcile",
    targetType: "company_billing",
    metadata: result,
  })

  return NextResponse.json({ ok: true, ...result })
}

export const GET = run
export const POST = run
