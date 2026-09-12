import { NextResponse } from "next/server"

import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { runTick } from "@/lib/outreach/tick"

// Ticken gjør nettverksarbeid mot IMAP, Brønnøysund og modellen. Den er
// tidsbokset i runTick og stopper pent før plattformen kutter den.
export const maxDuration = 300

/**
 * Én kjøring av salgsmaskinen.
 *
 * Startes av pg_cron hvert tiende minutt på hverdager (db/93). Vercel Hobby
 * tillater bare én cron-kjøring i døgnet, og svar-løkka trenger et langt
 * kortere intervall enn det — derfor bor planleggingen i Postgres, og Vercel
 * har bare en daglig reserve.
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

  try {
    const summary = await runTick({ budgetMs: 240_000 })

    // Loggfør bare kjøringer som faktisk gjorde noe — ellers drukner
    // aktivitetsloggen i 144 tomme ticks i døgnet.
    const didSomething =
      summary.send.sent > 0 ||
      summary.send.simulated > 0 ||
      (summary.inbox?.stored ?? 0) > 0 ||
      (summary.research?.succeeded ?? 0) > 0 ||
      (summary.drafts?.succeeded ?? 0) > 0 ||
      summary.expired > 0

    if (didSomething) {
      await logSellerActivity({
        sellerUserId: null,
        action: "cron_selger_tick",
        targetType: "prospects",
        metadata: {
          sent: summary.send.sent,
          simulated: summary.send.simulated,
          svar: summary.inbox?.stored ?? 0,
          researchet: summary.research?.succeeded ?? 0,
          utkast: summary.drafts?.succeeded ?? 0,
          utlopt: summary.expired,
          cost_usd: Number(summary.cost_usd.toFixed(4)),
        },
      })
    }

    return NextResponse.json(summary)
  } catch (error) {
    await logServerError({
      message: "Cron for salgsmaskinen feilet",
      error,
      source: "api",
      route: "GET /api/cron/selger-tick",
    })
    return NextResponse.json({ error: "Tick feilet" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return run(request)
}

/** pg_net sender POST. Samme kjøring. */
export async function POST(request: Request) {
  return run(request)
}
