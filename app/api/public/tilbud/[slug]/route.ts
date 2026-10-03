import { NextResponse } from "next/server"

import { isPlatformAdminEmail } from "@/lib/auth/platform-admin"
import { getServerAuthContext } from "@/lib/auth/server-context"
import { COMPANY_NOTIFICATION, createCompanyNotification } from "@/lib/notifications/company-notifications"
import { createAdminClient } from "@/lib/supabase/admin"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { shouldCountCustomerView } from "@/lib/tilbud/offer-tracking.shared"
import { fetchPublicOfferBySlug } from "@/lib/tilbud/public-offer"

const formatNok = (value: number) =>
  new Intl.NumberFormat("no-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 }).format(value)

/**
 * Er det kunden som åpner siden? Firmaets egne innloggede brukere, plattform-
 * admin (som lenker hit fra /sjefen) og lenkeskannere skal ikke gi «Åpnet».
 * Anonyme besøkende koster ingen databasekall her.
 */
async function isCustomerView(request: Request, offerCompanyId: string) {
  let viewerCompanyId: string | null = null
  let viewerIsPlatformAdmin = false
  try {
    const viewer = await getServerAuthContext()
    viewerCompanyId = viewer?.companyId ?? null
    viewerIsPlatformAdmin = isPlatformAdminEmail(viewer?.user.email)
  } catch {
    // Kunne ikke lese økten — behandle som anonym. Siden skal aldri feile av dette.
  }

  return shouldCountCustomerView({
    userAgent: request.headers.get("user-agent"),
    viewerCompanyId,
    offerCompanyId,
    viewerIsPlatformAdmin,
  })
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const offer = await fetchPublicOfferBySlug(slug)

  if (!offer || offer.status === "draft") {
    return NextResponse.json({ error: "Tilbudet finnes ikke" }, { status: 404 })
  }

  const admin = createAdminClient()
  const { data: viewState } = await admin.from("offers").select("customer_viewed_at").eq("id", offer.id).maybeSingle()

  if (!viewState?.customer_viewed_at && (await isCustomerView(request, offer.companyId))) {
    // Atomisk: av to samtidige innlastinger får bare den første raden tilbake,
    // så hendelsen og varselet lages én gang.
    const { data: stamped } = await admin
      .from("offers")
      .update({ customer_viewed_at: new Date().toISOString() })
      .eq("id", offer.id)
      .is("customer_viewed_at", null)
      .select("id")

    if (stamped && stamped.length > 0) {
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

      // Et tilbud som alt er godkjent eller avvist trenger ingen oppfølging.
      if (offer.status === "sent") {
        await createCompanyNotification(admin, {
          companyId: offer.companyId,
          kind: COMPANY_NOTIFICATION.OFFER_VIEWED,
          title: `${offer.customer.name} har åpnet tilbudet`,
          body: `${offer.title} · ${formatNok(offer.amountNok)}`,
          href: `/tilbud/${offer.id}`,
          offerId: offer.id,
        })
      }
    }
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
      pricingModel: snapshot?.pricingModel ?? offer.pricingModel,
      contractBasis: snapshot?.contractBasis ?? offer.contractBasis,
      acceptance: offer.acceptance,
    },
  })
}
