import { NextResponse } from "next/server"
import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"
import { acceptOfferWithCode, requestOfferAcceptCode } from "@/lib/tilbud/accept-offer"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { fetchPublicOfferBySlug } from "@/lib/tilbud/public-offer"

const respondSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request_code") }),
  z.object({
    action: z.literal("accept"),
    name: z.string().trim().min(2, "Skriv fullt navn").max(120),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, "Koden er 6 sifre"),
  }),
  z.object({ action: z.literal("reject") }),
])

const ACCEPT_ERROR_MESSAGES: Record<string, string> = {
  no_code: "Be om en engangskode først.",
  expired: "Engangskoden er utløpt. Be om en ny kode.",
  wrong_code: "Feil kode. Prøv igjen.",
  too_many_attempts: "For mange forsøk. Be om en ny kode.",
  not_respondable: "Tilbudet kan ikke besvares.",
  server_error: "Noe gikk galt. Prøv igjen.",
}

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

  if (parsed.data.action === "request_code") {
    const result = await requestOfferAcceptCode(offer)
    if (!result.ok) {
      if (result.error === "cooldown") {
        return NextResponse.json(
          { error: `Vent ${result.retryInSeconds} sekunder før du ber om ny kode`, retryInSeconds: result.retryInSeconds },
          { status: 429 }
        )
      }
      if (result.error === "missing_email") {
        return NextResponse.json({ error: "Tilbudet mangler mottaker-e-post" }, { status: 400 })
      }
      return NextResponse.json({ error: "Kunne ikke sende engangskode" }, { status: 500 })
    }
    return NextResponse.json({ ok: true, maskedEmail: result.maskedEmail })
  }

  if (parsed.data.action === "accept") {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
    const userAgent = request.headers.get("user-agent") || null

    const result = await acceptOfferWithCode({
      record: offer,
      name: parsed.data.name,
      code: parsed.data.code,
      ip,
      userAgent,
    })

    if (!result.ok) {
      const message = ACCEPT_ERROR_MESSAGES[result.error] || ACCEPT_ERROR_MESSAGES.server_error
      const status = result.error === "server_error" ? 500 : 400
      return NextResponse.json(
        { error: message, code: result.error, attemptsLeft: "attemptsLeft" in result ? result.attemptsLeft : undefined },
        { status }
      )
    }

    if (result.alreadyResponded) {
      return NextResponse.json({ ok: true, status: "accepted", alreadyResponded: true })
    }

    return NextResponse.json({ ok: true, status: "accepted", acceptance: result.acceptance })
  }

  // action === "reject" — unchanged flow: atomic flip guarded on status='sent'.
  const respondedAt = new Date().toISOString()
  const admin = createAdminClient()

  const { data: updated, error } = await admin
    .from("offers")
    .update({
      status: "rejected",
      customer_responded_at: respondedAt,
      updated_at: respondedAt,
    })
    .eq("id", offer.id)
    .eq("status", "sent")
    .select("id")

  if (error) {
    return NextResponse.json({ error: "Kunne ikke lagre svaret ditt" }, { status: 500 })
  }

  if (!updated || updated.length === 0) {
    return NextResponse.json({ ok: true, status: "rejected", alreadyResponded: true })
  }

  await logOfferActivity(
    {
      offerId: offer.id,
      companyId: offer.companyId,
      eventType: OFFER_ACTIVITY.REJECTED,
      title: "Kunde avslo tilbudet",
      description: offer.recipientEmail || offer.customer.email || undefined,
      metadata: { publicSlug: slug },
    },
    { admin: true }
  )

  return NextResponse.json({ ok: true, status: "rejected" })
}
