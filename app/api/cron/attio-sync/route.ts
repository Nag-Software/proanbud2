import { NextResponse } from "next/server"

import { logServerError } from "@/lib/errors/log"
import { isAttioEnabled, runAttioSync } from "@/lib/attio/sync"

export const maxDuration = 120

/**
 * Tømmer Attio-køen.
 *
 * Kalles av pg_cron hvert minutt når køen har noe (db/104), og av ticken som
 * reserve. Uten ATTIO_SYNC=on er dette en no-op — køen fylles, men ingenting
 * sendes før Casper har koblet til.
 *
 * Auth: `Authorization: Bearer $CRON_SECRET`, som de andre cronene.
 */
async function run(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET ikke konfigurert" }, { status: 500 })
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (!isAttioEnabled()) {
    return NextResponse.json({ ok: true, skipped: "Attio-synk er ikke skrudd på (ATTIO_SYNC=on)" })
  }

  try {
    // Godt under maxDuration (120 s): ett enkelt kall mot Attio kan bruke opptil 15 s.
    const summary = await runAttioSync({ budgetMs: 80_000 })
    return NextResponse.json(summary)
  } catch (error) {
    await logServerError({
      message: "Attio-synken feilet",
      error,
      source: "api",
      route: "POST /api/cron/attio-sync",
    })
    return NextResponse.json({ error: "Synken feilet" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return run(request)
}

/** pg_net sender POST. Samme kjøring. */
export async function POST(request: Request) {
  return run(request)
}
