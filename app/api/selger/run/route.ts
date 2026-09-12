import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { runPipeline } from "@/lib/outreach/pipeline"
import { isSegmentKey } from "@/lib/outreach/segments"

// Research og skriving er nettverks- og modelltunge. Kjøringen er tidsbokset i
// pipeline.ts, så den stopper pent før plattformen kutter den.
export const maxDuration = 300

const schema = z.object({
  segment: z.string().optional(),
  /** Hvor mange nye prospekter som skal meldes inn i research-køen. */
  queueLimit: z.number().int().min(1).max(100).optional(),
})

/**
 * «Kjør nå»: køer opp nye prospekter, researcher dem og skriver utkast — alt i
 * ett trykk, slik at Casper ser resultatet med en gang i stedet for å vente på
 * neste tick.
 */
export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const segment =
    parsed.data.segment && isSegmentKey(parsed.data.segment) ? parsed.data.segment : null

  try {
    const summary = await runPipeline({
      segment,
      queueLimit: parsed.data.queueLimit ?? 30,
      // Litt margin ned til maxDuration, så vi rekker å svare.
      budgetMs: 250_000,
    })

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "run_pipeline",
      targetType: "prospects",
      metadata: {
        segment,
        queued: summary.queued,
        researched: summary.research.succeeded,
        drafted: summary.drafts.succeeded,
        cost_usd: Number(summary.cost_usd.toFixed(4)),
      },
    })

    return NextResponse.json(summary)
  } catch (error) {
    await logServerError({
      message: "Kjøring av salgspipelinen feilet",
      error,
      source: "api",
      route: "POST /api/selger/run",
      context: { segment, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Kjøringen feilet — se feilloggen" }, { status: 500 })
  }
}
