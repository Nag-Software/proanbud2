import { NextResponse } from "next/server"

import { runAutoCloseStaleSessions } from "@/lib/timeforing/auto-close"

export const runtime = "nodejs"
export const maxDuration = 120

// Closes time sessions workers forgot to stop (shift end + max-hours), flagging
// them for manager approval. A geofence exit alone never stops the clock — this
// is the only automatic stop, so materials runs stay billed.
//
// Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Schedule in vercel.json.
async function run(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET ikke konfigurert" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runAutoCloseStaleSessions()
  return NextResponse.json({ ok: true, ...result })
}

export const GET = run
export const POST = run
