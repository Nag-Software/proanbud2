import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"
import { fetchOfferCompanyContext } from "@/lib/tilbud/company-profile"
import { readProjectSummaryFromAnalysis } from "@/lib/tilbud/project-summary"
import {
  buildOfferDocumentPage,
  buildOfferFooterParts,
  formatOfferReference,
  type OfferDocumentAcceptance,
  type OfferDocumentData,
} from "@/lib/tilbud/offer-document"
import { getOfferPdfFontCss, renderOfferPdf } from "@/lib/tilbud/offer-pdf"
import {
  toContractBasis,
  toPricingModel,
  type OfferLineItem,
  type OfferPaymentScheduleEntry,
} from "@/lib/tilbud/types"

export const runtime = "nodejs"
export const maxDuration = 60

type CustomerRow = {
  name: string | null
  email: string | null
  phone: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  org_number: string | null
}

type ProjectRow = { name: string | null; customers?: CustomerRow | CustomerRow[] | null }

type OfferRow = {
  id: string
  title: string | null
  description: string | null
  created_at: string | null
  quote_valid_until: string | null
  source_summary: string | null
  analysis_result: unknown
  line_items: unknown
  pricing_model: string | null
  contract_basis: string | null
  payment_schedule: unknown
  status: string | null
  accepted_at: string | null
  accepted_by_name: string | null
  accepted_email: string | null
  accepted_method: string | null
  accepted_document_sha256: string | null
  accepted_snapshot: unknown
  customers?: CustomerRow | CustomerRow[] | null
  projects?: ProjectRow | ProjectRow[] | null
}

function normalizeRelatedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

/** Minimal shape check before trusting a stored acceptance snapshot for rendering. */
function toAcceptedSnapshot(value: unknown): OfferDocumentData | null {
  if (!value || typeof value !== "object") return null
  const snapshot = value as Partial<OfferDocumentData>
  if (typeof snapshot.title !== "string" || !Array.isArray(snapshot.lineItems)) return null
  return snapshot as OfferDocumentData
}

function normalizeLineItems(input: unknown): OfferLineItem[] {
  if (!Array.isArray(input)) return []
  return input
    .map((row) => {
      const item = row as Partial<OfferLineItem>
      return {
        id: String(item.id || crypto.randomUUID()),
        subproject: String(item.subproject || "Generelt"),
        title: String(item.title || ""),
        description: String(item.description || ""),
        quantity: Number(item.quantity || 0),
        unit: String(item.unit || "stk"),
        supplier: String(item.supplier || ""),
        nobb: item.nobb ? String(item.nobb) : undefined,
        supplierSku: item.supplierSku ? String(item.supplierSku) : undefined,
        supplierUrl: item.supplierUrl ? String(item.supplierUrl) : undefined,
        unitPriceNok: Number(item.unitPriceNok || 0),
        markupPercent: Number(item.markupPercent || 0),
        discountPercent: Number(item.discountPercent || 0),
      }
    })
    .filter((item) => item.title.trim().length > 0)
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  const company = await fetchOfferCompanyContext(supabase, user.id)
  if (!company) return new Response("Ingen bedrift", { status: 404 })

  const { data: offerData } = await supabase
    .from("offers")
    .select(
      "id, title, description, created_at, quote_valid_until, source_summary, analysis_result, line_items, pricing_model, contract_basis, payment_schedule, status, accepted_at, accepted_by_name, accepted_email, accepted_method, accepted_document_sha256, accepted_snapshot, customers(name, email, phone, address, postal_code, city, org_number), projects(name, customers(name, email, phone, address, postal_code, city, org_number))"
    )
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle()

  if (!offerData) return new Response("Tilbud ikke funnet", { status: 404 })

  const offer = offerData as OfferRow
  const project = normalizeRelatedRow(offer.projects)
  const customer = normalizeRelatedRow(offer.customers) || normalizeRelatedRow(project?.customers)

  const acceptance: OfferDocumentAcceptance | null =
    offer.status === "accepted" && offer.accepted_at && offer.accepted_by_name && offer.accepted_method === "email_otp"
      ? {
          name: offer.accepted_by_name,
          email: offer.accepted_email || "",
          acceptedAt: offer.accepted_at,
          method: "email_otp",
          documentSha256: offer.accepted_document_sha256 || "",
        }
      : null

  const snapshot = toAcceptedSnapshot(offer.accepted_snapshot)

  // Accepted offers render from the frozen snapshot — the PDF is the binding
  // agreement document and must not change with later edits.
  const documentData: OfferDocumentData = snapshot
    ? { ...snapshot, acceptance }
    : {
        title: offer.title || "Tilbud",
        description: offer.description || "",
        projectSummary: readProjectSummaryFromAnalysis(offer.analysis_result),
        quoteMessage: offer.source_summary || "",
        projectName: project?.name || "",
        offerReference: formatOfferReference(offer.id),
        customer: {
          name: customer?.name || "Kunde",
          email: customer?.email,
          phone: customer?.phone,
          address: customer?.address,
          postalCode: customer?.postal_code,
          city: customer?.city,
          orgNumber: customer?.org_number,
        },
        lineItems: normalizeLineItems(offer.line_items),
        company,
        issuedDate: offer.created_at,
        quoteValidUntil: offer.quote_valid_until,
        paymentSchedule: Array.isArray(offer.payment_schedule)
          ? (offer.payment_schedule as OfferPaymentScheduleEntry[])
          : [],
        pricingModel: toPricingModel(offer.pricing_model),
        contractBasis: toContractBasis(offer.contract_basis),
        acceptance,
      }

  // Only show the logo when it is an absolute URL — a relative favicon fallback
  // would render as a broken image in the headless browser.
  const logoUrl = documentData.company?.logoUrl
  const showLogo = Boolean(logoUrl && /^https?:\/\//.test(logoUrl))
  const html = buildOfferDocumentPage(documentData, {
    autoPrint: false,
    showLogo,
    fontFaceCss: await getOfferPdfFontCss(),
    printMarginMode: "external",
  })

  try {
    const pdf = await renderOfferPdf(html, {
      footerText: buildOfferFooterParts(documentData.company).join("  ·  "),
    })
    const filename = `Tilbud-${formatOfferReference(offer.id)}.pdf`
    return new Response(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    })
  } catch (error) {
    console.error("[tilbud pdf] generering feilet", error)
    await logServerError({
      message: "Offer PDF generation failed",
      error,
      source: "api",
      route: "GET /api/tilbud/[id]/pdf",
      statusCode: 500,
      companyId: company.id,
      userId: user.id,
      context: { offerId: id },
    })
    return new Response("Kunne ikke generere PDF", { status: 500 })
  }
}
