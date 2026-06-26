import { NextResponse } from "next/server"
import { z } from "zod"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logSellerActivity } from "@/lib/selger/activity-log"
import { PROSPECT_STATUSES } from "@/lib/outreach/types"

const patchSchema = z.object({
  status: z.enum(PROSPECT_STATUSES).optional(),
  notes: z.string().max(5000).nullable().optional(),
  logCall: z.boolean().optional(),
})

// Must stay in sync with the list route's select so a PATCHed row returned to the
// client keeps every field ProspectRow renders (incl. engagement) and doesn't blank
// out the flame/opens/clicks when a status change swaps it into state.
const PROSPECT_SELECT =
  "id, org_number, name, nace_code, nace_description, employee_count, website, email, phone, address, postal_code, city, kommune, kommune_number, enrichment_status, status, is_existing_customer, notes, last_contacted_at, created_at, lead_score, open_count, click_count, is_hot, hot_since"

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.status) updates.status = parsed.data.status
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes

  if (parsed.data.logCall) {
    updates.last_contacted_at = new Date().toISOString()
    // First touch via phone bumps to "kontaktet" unless caller set a status.
    if (!parsed.data.status) updates.status = "kontaktet"
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("prospects")
    .update(updates)
    .eq("id", id)
    .select(PROSPECT_SELECT)
    .maybeSingle()

  if (error) {
    console.error("[outreach/prospects PATCH]", error)
    return NextResponse.json({ error: "Kunne ikke oppdatere prospekt" }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: "Fant ikke prospekt" }, { status: 404 })

  await logSellerActivity({
    sellerUserId: auth.user!.id,
    action: parsed.data.logCall ? "phone_call" : "update_prospect_status",
    targetType: "prospect",
    targetId: id,
    metadata: {
      companyName: data.name,
      status: data.status,
      loggedCall: Boolean(parsed.data.logCall),
    },
  })

  return NextResponse.json({ prospect: data })
}
