import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getExternalEntityLink } from "@/lib/integrations/tripletex/jobs"
import { tripletexOrderUrl } from "@/lib/integrations/tripletex/urls"
import {
  enqueueOfferTripletexSyncAndProcess,
  fetchOfferTripletexSyncStatus,
} from "@/lib/integrations/tripletex/sync"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"

async function resolveContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }

  return { supabase, companyId: userRow.company_id, userId: user.id }
}

function mergeContract(analysisResult: unknown, contract: Record<string, unknown>) {
  const base =
    analysisResult && typeof analysisResult === "object" ? { ...(analysisResult as Record<string, unknown>) } : {}
  return {
    ...base,
    contract,
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const { id: offerId } = await params

  const { data: offer, error: offerError } = await ctx.supabase
    .from("offers")
    .select("id, company_id, title, status, customer_id, project_id, analysis_result")
    .eq("id", offerId)
    .eq("company_id", ctx.companyId)
    .maybeSingle()

  if (offerError || !offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 })
  }

  if (!offer.customer_id || !offer.project_id) {
    return NextResponse.json(
      { error: "Tilbud må være koblet til både kunde og prosjekt før ordre kan opprettes i Tripletex." },
      { status: 400 }
    )
  }

  const enqueued = await enqueueOfferTripletexSyncAndProcess({
    companyId: ctx.companyId,
    offerId: offer.id,
    customerId: offer.customer_id,
    projectId: offer.project_id,
    source: "tripletex-contract",
    includeInvoice: true,
    waitForCompletion: true,
  })

  if (!enqueued) {
    return NextResponse.json({ error: "Tripletex er ikke tilkoblet for denne bedriften." }, { status: 400 })
  }

  const orderLink = await getExternalEntityLink({
    companyId: ctx.companyId,
    entityType: "order",
    localId: offer.id,
  })

  const syncStatus = await fetchOfferTripletexSyncStatus(
    ctx.companyId,
    offer.id,
    offer.customer_id,
    offer.project_id
  )

  const externalUrl =
    orderLink?.external_url ||
    (orderLink?.external_id ? tripletexOrderUrl(orderLink.external_id) : null)

  const contract = {
    provider: "tripletex",
    status: orderLink?.external_id ? "sent" : "error",
    envelopeId: orderLink?.external_id ? String(orderLink.external_id) : undefined,
    externalUrl,
    sentAt: new Date().toISOString(),
    signedAt: null,
    lastError: orderLink?.external_id ? null : "Ordre ble ikke opprettet i Tripletex",
    tripletex: syncStatus,
  }

  const updatedAnalysis = mergeContract(offer.analysis_result, contract)
  const sentAt = new Date().toISOString()

  const { error: updateError } = await ctx.supabase
    .from("offers")
    .update({
      analysis_result: updatedAnalysis,
      status: orderLink?.external_id ? "sent" : offer.status,
      sent_at: orderLink?.external_id ? sentAt : undefined,
      updated_at: sentAt,
    })
    .eq("id", offer.id)
    .eq("company_id", ctx.companyId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 })
  }

  await logOfferActivity({
    offerId: offer.id,
    companyId: ctx.companyId,
    actorUserId: ctx.userId,
    eventType: OFFER_ACTIVITY.CONTRACT_SENT,
    title: "Ordre opprettet i Tripletex",
    description: orderLink?.external_id
      ? `Ordre #${orderLink.external_id} er klar i Tripletex`
      : "Synkronisering til Tripletex feilet",
    metadata: {
      provider: "tripletex",
      orderExternalId: orderLink?.external_id || null,
      externalUrl,
    },
  })

  if (!orderLink?.external_id) {
    return NextResponse.json(
      { error: "Ordre ble ikke opprettet i Tripletex. Sjekk synk-status og prøv igjen.", contract },
      { status: 502 }
    )
  }

  return NextResponse.json({ success: true, contract })
}
