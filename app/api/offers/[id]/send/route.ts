import { NextResponse } from "next/server"
import { z } from "zod"

import { resolveOfferSendCompany, sendOfferToCustomer } from "@/lib/tilbud/send-offer"
import { enqueueOfferTripletexSyncAndProcess } from "@/lib/integrations/tripletex/sync"
import { createClient } from "@/lib/supabase/server"

const sendPayloadSchema = z.object({
  recipientName: z.string().trim().optional(),
  recipientEmail: z.string().trim().email("Ugyldig e-postadresse"),
  recipientPhone: z.string().trim().optional(),
  message: z.string().trim().optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await resolveOfferSendCompany()
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const parsed = sendPayloadSchema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Ugyldig forespørsel" }, { status: 400 })
  }

  try {
    const offer = await sendOfferToCustomer({
      offerId: id,
      companyId: context.companyId,
      company: context.company,
      recipientName: parsed.data.recipientName || "",
      recipientEmail: parsed.data.recipientEmail,
      recipientPhone: parsed.data.recipientPhone,
      message: parsed.data.message,
      actorUserId: context.userId,
    })

    const supabase = await createClient()
    const { data: offerRow } = await supabase
      .from("offers")
      .select("customer_id, project_id")
      .eq("id", id)
      .eq("company_id", context.companyId)
      .maybeSingle()

    if (offerRow?.customer_id && offerRow?.project_id) {
      await enqueueOfferTripletexSyncAndProcess({
        companyId: context.companyId,
        offerId: id,
        customerId: offerRow.customer_id,
        projectId: offerRow.project_id,
        source: "offer-send",
      })
    }

    return NextResponse.json({ ok: true, offer })
  } catch (error) {
    console.error("Failed to send offer email:", error)
    const message = error instanceof Error ? error.message : "Kunne ikke sende tilbud på e-post"
    const status = message.includes("finnes ikke") ? 404 : message.includes("ordrelinje") ? 400 : 502
    return NextResponse.json({ error: message }, { status })
  }
}
