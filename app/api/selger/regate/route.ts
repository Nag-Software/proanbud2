import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { regateProspects, type GateProspect } from "@/lib/outreach/regate"

// Enhet + roller per firma fra Brønnøysund — noen sekunder for en full innboks.
export const maxDuration = 60

const schema = z.object({
  /** Bestemte prospekter. Uten ids: alle kalde leads som ikke er sjekket ennå. */
  ids: z.array(z.string().uuid()).max(300).optional(),
  /** Sjekk også de som allerede har en dom (f.eks. etter endret e-post). */
  force: z.boolean().optional(),
})

/** Maks per kall — resten tas i neste trykk. */
const BATCH_LIMIT = 150

/** «Sjekk porter»: hent fersk Brønnøysund-data og regn ut hvem som lovlig kan
 *  få e-post. Endrer aldri status — bare kontaktpolicyen. */
export async function POST(request: Request) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const parsed = schema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  let query = admin.from("prospects").select("*").limit(BATCH_LIMIT)
  if (parsed.data.ids?.length) {
    query = query.in("id", parsed.data.ids)
  } else {
    query = query.in("status", ["ny", "kvalifisert", "kontaktet"]).order("created_at", { ascending: false })
    if (!parsed.data.force) query = query.eq("contact_policy", "ukjent")
  }

  const { data, error } = await query
  if (error) {
    await logServerError({
      message: "Portsjekk: kunne ikke hente prospekter",
      error,
      source: "api",
      route: "POST /api/selger/regate",
    })
    // Typisk: db/90 er ikke kjørt (contact_policy finnes ikke).
    return NextResponse.json(
      { error: "Kunne ikke hente leads — er migrasjon db/90 kjørt?" },
      { status: 500 },
    )
  }

  const prospects = (data ?? []) as GateProspect[]
  const summary = await regateProspects(admin, prospects, { concurrency: 6 })

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: "regate_prospects",
    targetType: "prospects",
    metadata: { ...summary.byPolicy, checked: summary.checked, errors: summary.errors },
  })

  return NextResponse.json({ ...summary, hasMore: prospects.length === BATCH_LIMIT })
}
