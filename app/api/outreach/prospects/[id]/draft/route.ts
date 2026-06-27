import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { generateOutreachDraft } from "@/lib/outreach/draft"

export const maxDuration = 60

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const { id } = await params
  const admin = createAdminClient()

  const { data: prospect } = await admin
    .from("prospects")
    .select("id, name, email, city, nace_description, employee_count")
    .eq("id", id)
    .maybeSingle()

  if (!prospect) return NextResponse.json({ error: "Fant ikke prospekt" }, { status: 404 })
  if (!prospect.email) {
    return NextResponse.json({ error: "Prospektet mangler e-post (berik først)" }, { status: 400 })
  }

  let draft: { subject: string; body: string }
  try {
    draft = await generateOutreachDraft({
      name: prospect.name,
      city: prospect.city,
      naceDescription: prospect.nace_description,
      employeeCount: prospect.employee_count,
    })
  } catch (error) {
    console.error("[outreach/draft]", error)
    await logServerError({
      message: "Kunne ikke lage utkast for prospekt",
      error,
      source: "api",
      route: "POST /api/outreach/prospects/[id]/draft",
      context: { prospectId: id, userId: auth.user!.id },
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kunne ikke lage utkast" },
      { status: 502 }
    )
  }

  // Replace any prior pending draft for this prospect.
  await admin
    .from("prospect_outreach")
    .delete()
    .eq("prospect_id", id)
    .in("status", ["awaiting_approval", "queued"])

  const { data: inserted, error: insertError } = await admin
    .from("prospect_outreach")
    .insert({
      prospect_id: id,
      channel: "email",
      step_index: 0,
      status: "awaiting_approval",
      ai_subject: draft.subject,
      ai_body: draft.body,
    })
    .select("id, ai_subject, ai_body")
    .single()

  if (insertError || !inserted) {
    console.error("[outreach/draft] insert", insertError)
    await logServerError({
      message: "Kunne ikke lagre utkast for prospekt",
      error: insertError,
      source: "api",
      route: "POST /api/outreach/prospects/[id]/draft",
      context: { prospectId: id, userId: auth.user!.id },
    })
    return NextResponse.json({ error: "Kunne ikke lagre utkast" }, { status: 500 })
  }

  return NextResponse.json({ draft: inserted })
}
