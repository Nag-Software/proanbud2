import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { draftOne } from "@/lib/outreach/pipeline"
import { researchProspect } from "@/lib/outreach/research/run"
import type { ProspectRow } from "@/lib/outreach/types"

// Brreg + regnskap + søk + crawl av seks sider + ett LLM-kall.
export const maxDuration = 120

const schema = z.object({
  /** Skriv et utkast med én gang research er ferdig. */
  draft: z.boolean().optional(),
})

/**
 * «Oppdater research» fra lead-kortet.
 *
 * Nullstiller forsøkstelleren først — et prospekt Casper selv ber om på nytt
 * skal ikke stoppes av at maskinen har prøvd tre ganger tidligere.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: existing } = await admin
    .from("prospects")
    .select("id")
    .eq("id", id)
    .maybeSingle()

  if (!existing) return NextResponse.json({ error: "Fant ikke leadet" }, { status: 404 })

  try {
    await admin
      .from("prospects")
      .update({ research_attempts: 0, research_error: null, research_locked_at: null })
      .eq("id", id)

    const outcome = await researchProspect(id)

    await logSellerActivity({
      sellerUserId: auth.user!.id,
      action: "research_prospect",
      targetType: "prospect",
      targetId: id,
      metadata: { verdict: outcome.verdict, cost_usd: Number(outcome.cost_usd.toFixed(4)) },
    })

    if (!parsed.data.draft || outcome.verdict !== "kvalifisert") {
      return NextResponse.json(outcome)
    }

    const { data: prospect } = await admin
      .from("prospects")
      .select("*")
      .eq("id", id)
      .maybeSingle<ProspectRow>()

    if (!prospect) return NextResponse.json(outcome)

    const draft = await draftOne(prospect)
    return NextResponse.json({
      ...outcome,
      draft: { ok: draft.ok, reason: draft.reason, messageId: draft.messageId ?? null },
      cost_usd: outcome.cost_usd + draft.cost_usd,
    })
  } catch (error) {
    await logServerError({
      message: "Research fra lead-kortet feilet",
      error,
      source: "api",
      route: "POST /api/selger/prospects/[id]/research",
      context: { prospectId: id, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Research feilet — prøv igjen" }, { status: 500 })
  }
}
