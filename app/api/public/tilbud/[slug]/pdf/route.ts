import { logServerError } from "@/lib/errors/log"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import {
  buildOfferDocumentPage,
  buildOfferFooterParts,
  type OfferDocumentData,
} from "@/lib/tilbud/offer-document"
import { getOfferPdfFontCss, renderOfferPdf } from "@/lib/tilbud/offer-pdf"
import { fetchPublicOfferBySlug } from "@/lib/tilbud/public-offer"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * Customer-facing PDF download for a shared offer link. Access control mirrors
 * the public payload route: the unguessable slug is the credential, and drafts
 * are never exposed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const offer = await fetchPublicOfferBySlug(slug)

  if (!offer || offer.status === "draft") {
    return new Response("Tilbudet finnes ikke", { status: 404 })
  }

  // Accepted offers render from the frozen snapshot — the PDF is the binding
  // agreement document and must not change with later edits.
  const documentData: OfferDocumentData = offer.acceptedSnapshot
    ? { ...offer.acceptedSnapshot, acceptance: offer.acceptance }
    : {
        title: offer.title,
        description: offer.description,
        projectSummary: offer.projectSummary,
        quoteMessage: offer.sourceSummary,
        projectName: offer.projectName,
        offerReference: offer.offerReference,
        customer: offer.customer,
        lineItems: offer.lineItems,
        company: offer.company,
        issuedDate: offer.createdAt,
        quoteValidUntil: offer.quoteValidUntil,
        validityDays: offer.validityDays,
        paymentSchedule: offer.paymentSchedule,
        pricingModel: offer.pricingModel,
        contractBasis: offer.contractBasis,
        acceptance: offer.acceptance,
      }

  const logoUrl = documentData.company?.logoUrl
  const showLogo = Boolean(logoUrl && /^https?:\/\//.test(logoUrl))
  const html = buildOfferDocumentPage(documentData, {
    autoPrint: false,
    // Suppliers are internal information — never expose them to the customer.
    showSupplier: false,
    showLogo,
    fontFaceCss: await getOfferPdfFontCss(),
    printMarginMode: "external",
  })

  try {
    const pdf = await renderOfferPdf(html, {
      footerText: buildOfferFooterParts(documentData.company).join("  ·  "),
    })

    // Fire-and-forget visibility for the sender's activity feed.
    void logOfferActivity(
      {
        offerId: offer.id,
        companyId: offer.companyId,
        eventType: OFFER_ACTIVITY.PDF_EXPORTED,
        title: "Kunde lastet ned tilbudet som PDF",
        description: offer.recipientEmail || offer.customer.email || undefined,
        metadata: { publicSlug: slug, source: "customer" },
      },
      { admin: true }
    )

    const filename = `Tilbud-${offer.offerReference}.pdf`
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[public tilbud pdf] generering feilet", error)
    await logServerError({
      message: "Public offer PDF generation failed",
      error,
      source: "api",
      route: "GET /api/public/tilbud/[slug]/pdf",
      statusCode: 500,
      companyId: offer.companyId,
      context: { offerId: offer.id },
    })
    return new Response("Kunne ikke generere PDF", { status: 500 })
  }
}
