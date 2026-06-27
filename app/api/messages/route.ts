import { NextResponse } from "next/server"
import { Resend } from "resend"
import { z } from "zod"

import { companyHasFeature } from "@/lib/billing/server-modules"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"
import { buildCustomerMessageEmail } from "@/lib/tilbud/customer-emails"
import { ensureOfferPublicSlug } from "@/lib/tilbud/public-offer"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

const sendSchema = z.object({
  customerId: z.string().uuid(),
  offerId: z.string().uuid().optional().nullable(),
  content: z.string().trim().min(1).max(4000),
  attachmentUrl: z.string().url().optional().nullable(),
  attachmentType: z.string().optional().nullable(),
  attachmentName: z.string().optional().nullable(),
})

export async function POST(request: Request) {
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

  if (!(await companyHasFeature(userRow.company_id, "meldinger"))) {
    return NextResponse.json(
      { error: "Meldinger krever Proff-abonnement.", code: "plan_required", feature: "meldinger" },
      { status: 403 }
    )
  }

  const body = await request.json().catch(() => null)
  const parsed = sendSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Ugyldig melding" }, { status: 400 })
  }

  const payload = {
    company_id: userRow.company_id,
    customer_id: parsed.data.customerId,
    offer_id: parsed.data.offerId || null,
    sender_type: "company" as const,
    sender_id: user.id,
    content: parsed.data.content,
    attachment_url: parsed.data.attachmentUrl || null,
    attachment_type: parsed.data.attachmentType || null,
    attachment_name: parsed.data.attachmentName || null,
  }

  const { data: message, error } = await supabase.from("messages").insert(payload).select("*").single()
  if (error || !message) {
    return NextResponse.json({ error: error?.message || "Kunne ikke sende melding" }, { status: 400 })
  }

  if (parsed.data.offerId) {
    const { data: offer } = await supabase
      .from("offers")
      .select("id, recipient_email, recipient_name, public_slug, customers(name, email), companies(name)")
      .eq("id", parsed.data.offerId)
      .eq("company_id", userRow.company_id)
      .maybeSingle()

    if (offer) {
      const customer = Array.isArray(offer.customers) ? offer.customers[0] : offer.customers
      const company = Array.isArray(offer.companies) ? offer.companies[0] : offer.companies
      const recipientEmail = String(offer.recipient_email || customer?.email || "").trim()

      if (recipientEmail) {
        try {
          const publicSlug = offer.public_slug || (await ensureOfferPublicSlug(offer.id, userRow.company_id))
          const html = buildCustomerMessageEmail({
            recipientName: offer.recipient_name || customer?.name || "Kunde",
            companyName: company?.name || "Proanbud",
            messagePreview: parsed.data.content,
            publicSlug,
          })

          const { error: sendError } = await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>",
            to: recipientEmail,
            subject: `Ny melding fra ${company?.name || "Proanbud"}`,
            html,
          })
          if (sendError) {
            console.error("[messages email] resend error", sendError)
            await logServerError({
              message: "Kunne ikke sende e-postvarsel om ny melding til kunde",
              error: sendError,
              level: "warning",
              source: "api",
              route: "POST /api/messages",
              context: { companyId: userRow.company_id, customerId: parsed.data.customerId, offerId: offer.id, userId: user.id },
            })
          }
        } catch (emailError) {
          console.error("[messages email]", emailError)
          await logServerError({
            message: "Feil under utsending av e-postvarsel om ny melding til kunde",
            error: emailError,
            level: "warning",
            source: "api",
            route: "POST /api/messages",
            context: { companyId: userRow.company_id, customerId: parsed.data.customerId, offerId: offer.id, userId: user.id },
          })
        }
      }
    }
  }

  return NextResponse.json({ ok: true, message })
}
