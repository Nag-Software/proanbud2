import { createAdminClient } from "@/lib/supabase/admin"
import { enqueueOfferTripletexSyncAndProcess } from "@/lib/integrations/tripletex/sync"
import { enqueueOfferFikenSyncAndProcess } from "@/lib/integrations/fiken/sync"
import { notifyCompanyAdminsAboutAcceptedOffer } from "@/lib/tilbud/notify-accepted-offer"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"

export async function handleOfferAccepted(input: {
  offerId: string
  companyId: string
  actorUserId?: string | null
  source?: string
}) {
  const admin = createAdminClient()
  const { data: offer, error } = await admin
    .from("offers")
    .select("id, title, status, customer_id, project_id")
    .eq("id", input.offerId)
    .eq("company_id", input.companyId)
    .maybeSingle()

  if (error || !offer) {
    throw new Error(error?.message || "Offer not found")
  }

  if (offer.status !== "accepted") {
    return { synced: false as const, reason: "offer_not_accepted" as const }
  }

  // An accepted offer means work begins — move the project into execution.
  // Only promote projects that are still in planning so we never override an
  // intentionally paused/completed project.
  if (offer.project_id) {
    await admin
      .from("projects")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", offer.project_id)
      .eq("company_id", input.companyId)
      .eq("status", "planning")
  }

  if (offer.customer_id) {
    // Only one accounting provider is connected at a time; each enqueue no-ops when
    // its provider isn't the active one. For Fiken, phase "order" creates the invoice
    // (Fiken has no mutable order — the quote→order→invoice flow collapses).
    const tripletexEnqueued = await enqueueOfferTripletexSyncAndProcess({
      companyId: input.companyId,
      offerId: input.offerId,
      customerId: String(offer.customer_id),
      projectId: offer.project_id ? String(offer.project_id) : null,
      source: input.source || "offer-accepted",
      phase: "order",
      waitForCompletion: false,
    })

    const fikenEnqueued = await enqueueOfferFikenSyncAndProcess({
      companyId: input.companyId,
      offerId: input.offerId,
      customerId: String(offer.customer_id),
      projectId: offer.project_id ? String(offer.project_id) : null,
      source: input.source || "offer-accepted",
      phase: "order",
      waitForCompletion: false,
    })

    if (tripletexEnqueued || fikenEnqueued) {
      await logOfferActivity({
        offerId: input.offerId,
        companyId: input.companyId,
        actorUserId: input.actorUserId || null,
        eventType: OFFER_ACTIVITY.ERP_ORDER_SYNCED,
        title: fikenEnqueued ? "Faktura opprettes i Fiken" : "Ordre opprettes i Tripletex",
        metadata: { source: input.source || "offer-accepted", provider: fikenEnqueued ? "fiken" : "tripletex" },
      })
    }
  }

  const { data: customer } = offer.customer_id
    ? await admin.from("customers").select("name").eq("id", offer.customer_id).maybeSingle()
    : { data: null }

  void notifyCompanyAdminsAboutAcceptedOffer({
    companyId: input.companyId,
    offerId: input.offerId,
    offerTitle: offer.title || "Uten tittel",
    customerName: customer?.name || "Kunde",
  })

  return { synced: true as const }
}
