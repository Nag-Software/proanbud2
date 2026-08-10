import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { runLifecycleEmails } from "@/lib/lifecycle/onboarding-emails"

export const maxDuration = 120

// Daglig, automatisk aktiverings-/livssyklus-sekvens: velkomst (dag 0), aktivering
// (dag 3 uten sendt tilbud), verdi-oppsummering (dag 10) og win-back (utløpt prøve).
// Sender bare ekte e-post når LIFECYCLE_EMAILS=on — ellers dry-run. Idempotent per mal.
//
// Auth: Vercel Cron sender `Authorization: Bearer $CRON_SECRET`. Schedule i vercel.json.
async function run(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET ikke konfigurert" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const result = await runLifecycleEmails(admin)

  await logSellerActivity({
    sellerUserId: null,
    action: "cron_lifecycle_emails",
    targetType: "company_billing",
    metadata: {
      live: result.live,
      considered: result.considered,
      sent: result.sent,
      skipped: result.skipped,
      failed: result.failed,
      wouldSend: result.wouldSend.length,
    },
  })

  return NextResponse.json({ ok: true, ...result })
}

export const GET = run
export const POST = run
