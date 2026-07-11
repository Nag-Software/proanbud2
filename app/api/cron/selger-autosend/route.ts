import { NextResponse } from "next/server"

import { runAutosendBatch } from "@/lib/outreach/autosend"
import { logServerError } from "@/lib/errors/log"

export const runtime = "nodejs"
export const maxDuration = 300

// Daglig (hverdager) automatisk e-postsekvens for kalde leads — se
// lib/outreach/autosend.ts for regler (kvote, suppresjon, stoppvilkår).
//
// Auth: Vercel Cron sender `Authorization: Bearer $CRON_SECRET`. Schedule i
// vercel.json (kl. 08:05 UTC man–fre ≈ 10:05 norsk sommertid).
//
// Kill-switch: OUTREACH_AUTOSEND må være "on" i env — en deploy alene skal
// ALDRI begynne å sende kald e-post.
async function run(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET ikke konfigurert" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if ((process.env.OUTREACH_AUTOSEND ?? "").trim().toLowerCase() !== "on") {
    return NextResponse.json({ ok: true, skipped: "OUTREACH_AUTOSEND er ikke 'on'" })
  }

  try {
    const summary = await runAutosendBatch()
    return NextResponse.json({ ok: true, ...summary })
  } catch (error) {
    console.error("[cron/selger-autosend]", error)
    await logServerError({
      message: "Autosend-cron feilet",
      error,
      source: "api",
      route: "GET /api/cron/selger-autosend",
    })
    return NextResponse.json({ error: "Autosend feilet" }, { status: 500 })
  }
}

export const GET = run
export const POST = run
