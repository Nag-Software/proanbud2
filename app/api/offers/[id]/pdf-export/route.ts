import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
  if (!userRow?.company_id) {
    return NextResponse.json({ error: "Company context missing" }, { status: 400 })
  }

  const { id } = await params
  const { data: offer } = await supabase
    .from("offers")
    .select("id, title")
    .eq("id", id)
    .eq("company_id", userRow.company_id)
    .maybeSingle()

  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 })
  }

  await logOfferActivity({
    offerId: id,
    companyId: userRow.company_id,
    actorUserId: user.id,
    eventType: OFFER_ACTIVITY.PDF_EXPORTED,
    title: "Tilbud lastet ned som PDF",
    description: offer.title || undefined,
  })

  return NextResponse.json({ ok: true })
}
