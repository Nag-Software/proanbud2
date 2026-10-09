import { NextResponse } from "next/server"

import { syncAllCompaniesToResend, isResendCrmEnabled } from "@/lib/resend-crm/sync"

export const maxDuration = 300

// Daglig sikkerhetsnett for Resend-synken (lib/resend-crm/sync.ts). Fanger opp
// overganger som hendelseskrokene ikke så — typisk en prøve som utløper uten
// at noen webhook kom — og holder kontaktfeltene ferske.
//
// Første import av eksisterende bedrifter: kall med ?mode=backfill. Da
// oppdateres kontakter og segmenter, men ingen events sendes, så gamle
// brukere ikke får velkomst-e-post.
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
  if (!isResendCrmEnabled()) {
    return NextResponse.json({ ok: true, skipped: "RESEND_CRM er ikke 'on'" })
  }

  const mode = new URL(request.url).searchParams.get("mode")
  const result = await syncAllCompaniesToResend({ allowEvents: mode !== "backfill" })
  return NextResponse.json({ ok: true, mode: mode ?? "daily", ...result })
}

export const GET = run
export const POST = run
