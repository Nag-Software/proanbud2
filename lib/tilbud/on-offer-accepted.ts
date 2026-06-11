import { createAdminClient } from "@/lib/supabase/admin"
import { enqueueOfferTripletexSyncAndProcess } from "@/lib/integrations/tripletex/sync"
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

  if (offer.customer_id) {
    const enqueued = await enqueueOfferTripletexSyncAndProcess({
      companyId: input.companyId,
      offerId: input.offerId,
      customerId: String(offer.customer_id),
      projectId: offer.project_id ? String(offer.project_id) : null,
      source: input.source || "offer-accepted",
      phase: "order",
      waitForCompletion: false,
    })

    if (enqueued) {
      await logOfferActivity({
        offerId: input.offerId,
        companyId: input.companyId,
        actorUserId: input.actorUserId || null,
        eventType: OFFER_ACTIVITY.ERP_ORDER_SYNCED,
        title: "Ordre opprettes i Tripletex",
        metadata: { source: input.source || "offer-accepted" },
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
