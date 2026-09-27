import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { backfillAttioQueue, setupAttio } from "@/lib/attio/oppsett"
import { fetchAttioStatus } from "@/lib/attio/status"
import { runAttioSync } from "@/lib/attio/sync"

// Oppsettet er en håndfull kall mot Attio; «synk nå» er tidsbokset under dette.
export const maxDuration = 60

const schema = z.object({
  action: z.enum(["oppsett", "synk_na", "synk_alle"]),
})

export async function GET() {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error
  return NextResponse.json(await fetchAttioStatus())
}

/**
 * «Sett opp» gjør Attio klart (felt, steg, webhook) og legger alle varme leads
 * i køen. «Synk nå» tømmer køen med én gang i stedet for å vente på cron.
 * «Synk alle» legger alle varme og aktive leads i køen på nytt.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })

  try {
    if (parsed.data.action === "oppsett") {
      const report = await setupAttio()
      await logSellerActivity({
        sellerUserId: auth.user!.id,
        action: "attio_oppsett",
        targetType: "settings",
        metadata: { ok: report.ok, workspace: report.workspace, queued: report.queued },
      })
      return NextResponse.json({ report, status: await fetchAttioStatus() })
    }

    if (parsed.data.action === "synk_alle") {
      const queued = await backfillAttioQueue(createAdminClient())
      return NextResponse.json({ queued, status: await fetchAttioStatus() })
    }

    // Godt under maxDuration: ett enkelt kall mot Attio kan bruke opptil 15 s.
    const summary = await runAttioSync({ budgetMs: 35_000 })
    return NextResponse.json({ summary, status: await fetchAttioStatus() })
  } catch (error) {
    await logServerError({
      message: "Attio-handling feilet",
      error,
      source: "api",
      route: "POST /api/selger/attio",
      context: { action: parsed.data.action, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Det feilet — prøv igjen" }, { status: 500 })
  }
}
