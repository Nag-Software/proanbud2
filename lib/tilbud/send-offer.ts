import { Resend } from "resend"

import { fetchOfferCompanyContext } from "@/lib/tilbud/company-profile"
import { buildOfferSentCustomerEmail } from "@/lib/tilbud/customer-emails"
import { ensureOfferPublicSlug } from "@/lib/tilbud/public-offer"
import { calculateOfferTotals, type OfferCompanyContext, type OfferLineItem } from "@/lib/tilbud/types"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { createClient } from "@/lib/supabase/server"
import { canSendOffers } from "@/lib/roles"
import {
  computeValidUntilDate,
  formatDocumentCurrency,
  formatOfferDate,
  formatOfferReference,
  getOfferDocumentTotals,
} from "@/lib/tilbud/offer-document"

const resend = new Resend(process.env.RESEND_API_KEY || "re_defaultkey")

type SendOfferInput = {
  offerId: string
  companyId: string
  company: OfferCompanyContext
  recipientName: string
  recipientEmail: string
  recipientPhone?: string | null
  message?: string | null
  actorUserId?: string | null
}

type OfferSendRecord = {
  id: string
  title: string | null
  description: string | null
  created_at: string | null
  quote_valid_until: string | null
  analysis_result: unknown
  source_summary: string | null
  line_items: unknown
  recipient_name: string | null
  recipient_email: string | null
  recipient_phone: string | null
  customers?:
    | {
        name: string | null
        email: string | null
        phone: string | null
        address: string | null
        city: string | null
        org_number: string | null
      }
    | {
        name: string | null
        email: string | null
        phone: string | null
        address: string | null
        city: string | null
        org_number: string | null
      }[]
    | null
  projects?:
    | {
        name: string | null
      }
    | {
        name: string | null
      }[]
    | null
}

function normalizeLineItems(input: unknown): OfferLineItem[] {
  if (!Array.isArray(input)) return []

  return input.map((row) => {
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
}

function normalizeRelatedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] || null
  }

  return value || null
}

export async function sendOfferToCustomer(input: SendOfferInput) {
  const supabase = await createClient()

  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select(
      "id, title, description, created_at, quote_valid_until, source_summary, analysis_result, line_items, recipient_name, recipient_email, recipient_phone, customers(name, email, phone, address, city, org_number), projects(name)"
    )
    .eq("id", input.offerId)
    .eq("company_id", input.companyId)
    .maybeSingle()

  if (offerError || !offer) {
    throw new Error(offerError?.message || "Tilbudet finnes ikke")
  }

  const offerRecord = offer as OfferSendRecord
  const lineItems = normalizeLineItems(offerRecord.line_items).filter((item) => item.title.trim().length > 0)
  if (lineItems.length === 0) {
    throw new Error("Tilbudet må inneholde minst én ordrelinje før utsending")
  }

  const customer = normalizeRelatedRow(offerRecord.customers)
  const project = normalizeRelatedRow(offerRecord.projects)
  const recipientName = input.recipientName.trim() || offerRecord.recipient_name || customer?.name || "Kunde"
  const recipientEmail = input.recipientEmail.trim()
  const recipientPhone = input.recipientPhone?.trim() || offerRecord.recipient_phone || customer?.phone || null
  const quoteMessage = input.message?.trim() || offerRecord.source_summary || ""
  const sentAt = new Date().toISOString()
  const companyName = input.company.name || "Proanbud"
  const offerReference = formatOfferReference(offerRecord.id)
  const publicSlug = await ensureOfferPublicSlug(input.offerId, input.companyId)

  const totals = calculateOfferTotals(lineItems)
  const { totalInclVatNok } = getOfferDocumentTotals(lineItems)
  const validUntil = computeValidUntilDate(offerRecord.created_at, offerRecord.quote_valid_until)

  const emailHtml = buildOfferSentCustomerEmail({
    recipientName,
    companyName,
    projectName: project?.name,
    quoteMessage,
    publicSlug,
    offerReference,
    totalInclVatText: formatDocumentCurrency(totalInclVatNok),
    validUntilText: validUntil ? formatOfferDate(validUntil) : null,
  })

  const { error: sendError } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL?.trim() || "Proanbud <post@proanbud.no>",
    to: recipientEmail,
    subject: `Tilbud ${offerReference} fra ${companyName}`,
    html: emailHtml,
  })
  // Må kaste FØR offers.status settes til "sent" nedenfor — ellers markeres
  // tilbudet som sendt selv om e-posten aldri nådde kunden.
  if (sendError) {
    throw new Error(`Kunne ikke sende tilbud på e-post: ${sendError.message ?? JSON.stringify(sendError)}`)
  }

  const { error: updateError } = await supabase
    .from("offers")
    .update({
      status: "sent",
      sent_at: sentAt,
      send_to_customer_direct: true,
      public_slug: publicSlug,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      recipient_phone: recipientPhone,
      subtotal_nok: totals.subtotalNok,
      discount_nok: totals.discountNok,
      amount_nok: Math.round(totals.totalNok),
      updated_at: sentAt,
    })
    .eq("id", input.offerId)
    .eq("company_id", input.companyId)

  if (updateError) {
    throw new Error(updateError.message)
  }

  await logOfferActivity({
    offerId: input.offerId,
    companyId: input.companyId,
    actorUserId: input.actorUserId || null,
    eventType: OFFER_ACTIVITY.SENT,
    title: "Tilbud sendt på e-post",
    description: `Sendt til ${recipientEmail}`,
    metadata: {
      recipientEmail,
      recipientName,
      lineItemCount: lineItems.length,
      amountNok: Math.round(totals.totalNok),
      publicSlug,
    },
  })

  return {
    id: offerRecord.id,
    status: "sent" as const,
    sentAt,
    recipientEmail,
    recipientName,
  }
}

export async function resolveOfferSendCompany() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  // Sending an offer (e-mail + ERP sync) is a manager/admin action. The send API
  // previously did no role check, so a worker could trigger a send directly.
  const { data: roleRow } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle()
  if (!canSendOffers(roleRow?.role)) {
    return null
  }

  const company = await fetchOfferCompanyContext(supabase, user.id)
  if (!company) {
    return null
  }

  return {
    companyId: company.id,
    userId: user.id,
    company,
  }
}
