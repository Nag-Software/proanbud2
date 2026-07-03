import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"

const logSchema = z.object({
  type: z.enum(["call", "note"]),
  note: z.string().max(5000).optional(),
  /** Kun for type=call. */
  outcome: z
    .enum(["svar_interessert", "svar_ikke_interessert", "ikke_svar", "beskjed", "feil_nummer"])
    .optional(),
})

/** Logg en samtale eller et notat på leadet — havner på tidslinjen.
 *  Notater er append-only med dato (prospects.notes-feltet er «festet kontekst»). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = logSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }
  if (parsed.data.type === "note" && !parsed.data.note?.trim()) {
    return NextResponse.json({ error: "Notatet er tomt" }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  const { data: prospect } = await admin
    .from("prospects")
    .select("id, name")
    .eq("id", id)
    .maybeSingle()
  if (!prospect) return NextResponse.json({ error: "Fant ikke leadet" }, { status: 404 })

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: parsed.data.type === "call" ? "phone_call" : "note",
    targetType: "prospect",
    targetId: id,
    metadata: {
      companyName: prospect.name,
      note: parsed.data.note?.trim() || null,
      ...(parsed.data.type === "call" ? { outcome: parsed.data.outcome ?? null } : {}),
    },
  })

  const updates: Record<string, unknown> = { last_activity_at: now, updated_at: now }
  if (parsed.data.type === "call") updates.last_contacted_at = now
  await admin.from("prospects").update(updates).eq("id", id)

  return NextResponse.json({ ok: true })
}
