import { NextResponse } from "next/server"

import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { bridgeAnalyseLeads } from "@/lib/outreach/analyse-bro"
import { runRetention } from "@/lib/outreach/retention"

export const maxDuration = 120

/**
 * Daglig vedlikehold: speil analyse-leads inn i pipelinen, og slett det vi
 * ikke lenger har grunnlag for å beholde.
 *
 * De to hører sammen fordi begge handler om hva vi lagrer om folk vi ikke har
 * et kundeforhold til — den ene fyller på, den andre rydder.
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
    const bridge = await bridgeAnalyseLeads({ limit: 100 })
    const retention = await runRetention(12)

    if (bridge.created > 0 || bridge.linked > 0 || retention.dossierer > 0) {
      await logSellerActivity({
        sellerUserId: null,
        action: "cron_selger_vedlikehold",
        targetType: "prospects",
        metadata: {
          analyse_nye: bridge.created,
          analyse_koblet: bridge.linked,
          slettet_dossierer: retention.dossierer,
          tommet_sidetekst: retention.sidetekst,
        },
      })
    }

    return NextResponse.json({ bridge, retention })
  } catch (error) {
    await logServerError({
      message: "Daglig vedlikehold for salgsmaskinen feilet",
      error,
      source: "api",
      route: "GET /api/cron/selger-retention",
    })
    return NextResponse.json({ error: "Vedlikeholdet feilet" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  return run(request)
}

export async function POST(request: Request) {
  return run(request)
}
