import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { fetchPublicOfferBySlug } from "@/lib/tilbud/public-offer"

const messageSchema = z.object({
  content: z.string().trim().min(1).max(4000),
})

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const offer = await fetchPublicOfferBySlug(slug)

  if (!offer || offer.status === "draft") {
    return NextResponse.json({ error: "Tilbudet finnes ikke" }, { status: 404 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("messages")
    .select("id, sender_type, content, created_at, attachment_url, attachment_name, attachment_type")
    .eq("offer_id", offer.id)
    .order("created_at", { ascending: true })

  if (error) {
    return NextResponse.json({ error: "Kunne ikke hente meldinger" }, { status: 500 })
  }

  return NextResponse.json({
    messages: (data || []).map((row) => ({
      id: row.id,
      senderType: row.sender_type,
      content: row.content,
      createdAt: row.created_at,
      attachmentUrl: row.attachment_url,
      attachmentName: row.attachment_name,
      attachmentType: row.attachment_type,
    })),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const offer = await fetchPublicOfferBySlug(slug)

  if (!offer || offer.status === "draft") {
    return NextResponse.json({ error: "Tilbudet finnes ikke" }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const parsed = messageSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Meldingen er ugyldig" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("messages")
    .insert({
      company_id: offer.companyId,
      customer_id: offer.customerId,
      offer_id: offer.id,
      sender_type: "customer",
      sender_id: null,
      content: parsed.data.content,
    })
    .select("id, sender_type, content, created_at")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: "Kunne ikke sende melding" }, { status: 500 })
  }

  await logOfferActivity({
    offerId: offer.id,
    companyId: offer.companyId,
    eventType: OFFER_ACTIVITY.CUSTOMER_MESSAGE,
    title: "Ny melding fra kunde",
    description: parsed.data.content.slice(0, 180),
    metadata: { publicSlug: slug },
  })

  return NextResponse.json({
    message: {
      id: data.id,
      senderType: data.sender_type,
      content: data.content,
      createdAt: data.created_at,
    },
  })
}
