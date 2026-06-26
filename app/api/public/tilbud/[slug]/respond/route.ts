import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import { handleOfferAccepted } from "@/lib/tilbud/on-offer-accepted"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { fetchPublicOfferBySlug } from "@/lib/tilbud/public-offer"

const respondSchema = z.object({
  action: z.enum(["accept", "reject"]),
})

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const offer = await fetchPublicOfferBySlug(slug)

  if (!offer) {
    return NextResponse.json({ error: "Tilbudet finnes ikke" }, { status: 404 })
  }

  if (!offer.canRespond) {
    return NextResponse.json({ error: "Tilbudet kan ikke besvares" }, { status: 400 })
  }

  const body = await request.json().catch(() => null)
  const parsed = respondSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig forespørsel" }, { status: 400 })
  }

  const nextStatus = parsed.data.action === "accept" ? "accepted" : "rejected"
  const respondedAt = new Date().toISOString()
  const admin = createAdminClient()

  const { data: updated, error } = await admin
    .from("offers")
    .update({
      status: nextStatus,
      customer_responded_at: respondedAt,
      updated_at: respondedAt,
    })
    .eq("id", offer.id)
    .eq("status", "sent")
    .select("id")

  if (error) {
    return NextResponse.json({ error: "Kunne ikke lagre svaret ditt" }, { status: 500 })
  }

  // Only run side-effects when THIS call actually flipped the status (it was still
  // "sent") — prevents duplicate activity logs / admin e-poster on race/double-click.
  if (!updated || updated.length === 0) {
    return NextResponse.json({ ok: true, status: nextStatus, alreadyResponded: true })
  }

  await logOfferActivity(
    {
      offerId: offer.id,
      companyId: offer.companyId,
      eventType: parsed.data.action === "accept" ? OFFER_ACTIVITY.ACCEPTED : OFFER_ACTIVITY.REJECTED,
      title: parsed.data.action === "accept" ? "Kunde godtok tilbudet" : "Kunde avslo tilbudet",
      description: offer.recipientEmail || offer.customer.email || undefined,
      metadata: { publicSlug: slug },
    },
    { admin: true }
  )

  if (parsed.data.action === "accept") {
    void handleOfferAccepted({
      offerId: offer.id,
      companyId: offer.companyId,
      source: "public_accept",
    }).catch((error) => {
      console.error("Failed to sync Tripletex order after public accept:", error)
      void logServerError({
        message: "Tripletex-synk feilet etter offentlig godkjenning av tilbud",
        error,
        source: "api",
        route: "app/api/public/tilbud/[slug]/respond/route.ts",
        level: "warning",
        context: { offerId: offer.id, companyId: offer.companyId },
      })
    })
  }

  return NextResponse.json({ ok: true, status: nextStatus })
}
