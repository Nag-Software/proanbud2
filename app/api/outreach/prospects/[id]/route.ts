import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { logServerError } from "@/lib/errors/log"
import { PROSPECT_STATUSES } from "@/lib/outreach/types"
import { LOST_REASONS } from "@/lib/selger/types"

const patchSchema = z.object({
  status: z.enum(PROSPECT_STATUSES).optional(),
  notes: z.string().max(5000).nullable().optional(),
  logCall: z.boolean().optional(),
  /** Kun relevant sammen med status="tapt". */
  lostReason: z.enum(LOST_REASONS).optional(),
  lostNote: z.string().max(2000).optional(),
})

// Must stay in sync with the list route's select so a PATCHed row returned to the
// client keeps every field ProspectRow renders (incl. engagement) and doesn't blank
// out the flame/opens/clicks when a status change swaps it into state.
const PROSPECT_SELECT =
  "id, org_number, name, nace_code, nace_description, employee_count, website, email, phone, address, postal_code, city, kommune, kommune_number, source, enrichment_status, status, matched_company_id, is_existing_customer, notes, last_contacted_at, last_activity_at, stage_entered_at, created_at, lead_score, open_count, click_count, is_hot, hot_since"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const admin = createAdminClient()
  const now = new Date().toISOString()

  // Hent nåværende status så tidslinjen kan vise «Kald lead → Kontaktet».
  const { data: before } = await admin
    .from("prospects")
    .select("status")
    .eq("id", id)
    .maybeSingle()
  if (!before) return NextResponse.json({ error: "Fant ikke prospekt" }, { status: 404 })

  const updates: Record<string, unknown> = { updated_at: now }
  if (parsed.data.status) updates.status = parsed.data.status
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes

  if (parsed.data.logCall) {
    updates.last_contacted_at = now
    // First touch via phone bumps to "kontaktet" unless caller set a status.
    if (!parsed.data.status && (before.status === "ny" || before.status === "kvalifisert")) {
      updates.status = "kontaktet"
    }
  }

  const statusChanged = Boolean(updates.status && updates.status !== before.status)
  if (statusChanged) updates.stage_entered_at = now
  // Alle selger-initierte endringer er aktivitet.
  updates.last_activity_at = now

  const { data, error } = await admin
    .from("prospects")
    .update(updates)
    .eq("id", id)
    .select(PROSPECT_SELECT)
    .maybeSingle()

  if (error) {
    console.error("[outreach/prospects PATCH]", error)
    await logServerError({
      message: "Kunne ikke oppdatere prospekt",
      error,
      source: "api",
      route: "PATCH /api/outreach/prospects/[id]",
      context: { prospectId: id, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Kunne ikke oppdatere prospekt" }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: "Fant ikke prospekt" }, { status: 404 })

  const action = parsed.data.logCall
    ? "phone_call"
    : data.status === "kunde" && statusChanged
      ? "won_prospect"
      : data.status === "tapt" && statusChanged
        ? "lost_prospect"
        : "update_prospect_status"

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action,
    targetType: "prospect",
    targetId: id,
    metadata: {
      companyName: data.name,
      from: before.status,
      to: data.status,
      status: data.status,
      loggedCall: Boolean(parsed.data.logCall),
      ...(parsed.data.lostReason ? { lostReason: parsed.data.lostReason } : {}),
      ...(parsed.data.lostNote?.trim() ? { note: parsed.data.lostNote.trim() } : {}),
    },
  })

  return NextResponse.json({ prospect: data })
}
