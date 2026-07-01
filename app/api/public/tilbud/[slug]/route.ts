import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { fetchPublicOfferBySlug } from "@/lib/tilbud/public-offer"

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const offer = await fetchPublicOfferBySlug(slug)

  if (!offer || offer.status === "draft") {
    return NextResponse.json({ error: "Tilbudet finnes ikke" }, { status: 404 })
  }

  const admin = createAdminClient()
  const { data: viewState } = await admin.from("offers").select("customer_viewed_at").eq("id", offer.id).maybeSingle()

  if (!viewState?.customer_viewed_at) {
    await admin
      .from("offers")
      .update({ customer_viewed_at: new Date().toISOString() })
      .eq("id", offer.id)

    await logOfferActivity(
      {
        offerId: offer.id,
        companyId: offer.companyId,
        eventType: OFFER_ACTIVITY.VIEWED,
        title: "Kunde åpnet tilbudet",
        description: offer.recipientEmail || offer.customer.email || undefined,
        metadata: { publicSlug: slug },
      },
      { admin: true }
    )
  }

  // After acceptance the page shows the frozen snapshot — what was agreed,
  // not whatever the offer rows contain later.
  const snapshot = offer.acceptedSnapshot

  return NextResponse.json({
    offer: {
      title: snapshot?.title ?? offer.title,
      description: snapshot?.description ?? offer.description,
      projectSummary: snapshot?.projectSummary ?? offer.projectSummary,
      sourceSummary: snapshot?.quoteMessage ?? offer.sourceSummary,
      status: offer.status,
      amountNok: offer.amountNok,
      quoteValidUntil: snapshot?.quoteValidUntil ?? offer.quoteValidUntil,
      createdAt: offer.createdAt,
      validityDays: snapshot?.validityDays ?? offer.validityDays,
      offerReference: offer.offerReference,
      isExpired: offer.isExpired,
      canRespond: offer.canRespond,
      projectName: snapshot?.projectName ?? offer.projectName,
      lineItems: snapshot?.lineItems ?? offer.lineItems,
      company: snapshot?.company ?? offer.company,
      customer: snapshot?.customer ?? offer.customer,
      paymentSchedule: snapshot?.paymentSchedule ?? offer.paymentSchedule,
      pricingModel: snapshot?.pricingModel ?? offer.pricingModel,
      contractBasis: snapshot?.contractBasis ?? offer.contractBasis,
      acceptance: offer.acceptance,
    },
  })
}
