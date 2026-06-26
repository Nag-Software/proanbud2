import { NextResponse } from "next/server"

import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"
import { canSendOffers } from "@/lib/roles"
import { handleOfferAccepted } from "@/lib/tilbud/on-offer-accepted"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import {
  calculateOfferTotals,
  type OfferContractBasis,
  type OfferLineItem,
  type OfferPricingModel,
} from "@/lib/tilbud/types"

type UpdatePayload = {
  activitySource?: "autosave" | "manual"
  title?: string
  description?: string
  status?: "draft" | "sent" | "accepted" | "rejected"
  quoteValidUntil?: string | null
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  customerAddress?: string
  customerPostalCode?: string
  customerCity?: string
  customerOrgNumber?: string
  recipientName?: string
  recipientEmail?: string
  recipientPhone?: string
  sourceSummary?: string
  lineItems?: OfferLineItem[]
  pricingModel?: OfferPricingModel
  contractBasis?: OfferContractBasis
  markupPercent?: number
  paymentSchedule?: Array<{ label: string; percent: number; dueDescription?: string }>
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

async function resolveContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const { data: userRow } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()
  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }

  // Editing/sending/accepting offers is a manager/admin action — the /tilbud UI is
  // gated to those roles, but this API previously did no role check, so a worker (or
  // a project member defaulted to access_level 'write') could mutate offers directly.
  if (!canSendOffers(userRow.role)) {
    return { error: NextResponse.json({ error: "Du har ikke tilgang til å endre tilbud." }, { status: 403 }) }
  }

  return { supabase, companyId: userRow.company_id, userId: user.id }
}

const statusLabels: Record<string, string> = {
  draft: "Utkast",
  sent: "Tilbud sendt",
  accepted: "Godkjent",
  rejected: "Avvist",
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const { id } = await params
  const payload = (await request.json()) as UpdatePayload

  const { data: existingOffer, error: existingOfferError } = await ctx.supabase
    .from("offers")
    .select("id, customer_id, status, title")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle()

  if (existingOfferError || !existingOffer) {
    return NextResponse.json({ error: existingOfferError?.message || "Offer not found" }, { status: 404 })
  }

  const previousStatusValue = existingOffer.status || "draft"

  // "sent" must go through the dedicated /send route (it generates the public slug,
  // stamps sent_at and emails the customer). A bare PATCH must never flip to "sent",
  // which would otherwise mark an offer as sent without anything actually being sent.
  if (payload.status === "sent" && previousStatusValue !== "sent") {
    return NextResponse.json(
      { error: "Bruk «Send tilbud» for å sende tilbudet." },
      { status: 400 }
    )
  }

  // Financial fields are frozen once an offer is sent or accepted: the customer has
  // seen/agreed to a binding amount and the ERP order is derived from it. Editing them
  // afterwards would let the stored amount diverge from what was agreed/invoiced.
  const isFinanciallyLocked = previousStatusValue === "sent" || previousStatusValue === "accepted"

  // Build the update incrementally so a partial PATCH never wipes columns the caller
  // didn't send (previously an omitted `lineItems` reset line_items to [] and zeroed totals).
  const updateRow: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  if (payload.title !== undefined) updateRow.title = payload.title?.trim() || "Uten tittel"
  if (payload.description !== undefined) updateRow.description = payload.description?.trim() || ""
  if (payload.status !== undefined) updateRow.status = payload.status
  if (payload.quoteValidUntil !== undefined) updateRow.quote_valid_until = payload.quoteValidUntil || null
  if (payload.recipientName !== undefined) updateRow.recipient_name = payload.recipientName?.trim() || null
  if (payload.recipientEmail !== undefined) updateRow.recipient_email = payload.recipientEmail?.trim() || null
  if (payload.recipientPhone !== undefined) updateRow.recipient_phone = payload.recipientPhone?.trim() || null
  if (payload.sourceSummary !== undefined) updateRow.source_summary = payload.sourceSummary?.trim() || ""

  let lineItemCount = 0

  // When locked we silently IGNORE financial fields rather than reject: the autosave
  // sends a full snapshot (incl. lineItems) on every change, so a hard reject would
  // also block legitimate non-financial edits and the sent→accepted transition. The
  // response flags `financialFieldsLocked` so the UI can disable financial editing.
  if (!isFinanciallyLocked) {
    if (payload.lineItems !== undefined) {
      const lineItems = normalizeLineItems(payload.lineItems)
      const totals = calculateOfferTotals(lineItems)
      updateRow.line_items = lineItems
      updateRow.subtotal_nok = totals.subtotalNok
      updateRow.discount_nok = totals.discountNok
      updateRow.amount_nok = Math.round(totals.totalNok)
      lineItemCount = lineItems.length
    }
    if (payload.pricingModel !== undefined) updateRow.pricing_model = payload.pricingModel
    if (payload.contractBasis !== undefined) updateRow.contract_basis = payload.contractBasis
    if (payload.markupPercent !== undefined) updateRow.markup_percent = Number(payload.markupPercent)
    if (payload.paymentSchedule !== undefined) updateRow.payment_schedule = payload.paymentSchedule
  }

  const { data, error } = await ctx.supabase
    .from("offers")
    .update(updateRow)
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .select("id, amount_nok, subtotal_nok, discount_nok, updated_at")
    .single()

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Offer not found" }, { status: 400 })
  }

  const previousStatus = previousStatusValue
  const nextStatus = (updateRow.status as string | undefined) ?? previousStatus
  const statusChanged = nextStatus !== previousStatus
  const loggedTitle = (updateRow.title as string | undefined) ?? existingOffer.title ?? "Uten tittel"
  const shouldLogUpdate = payload.activitySource !== "autosave" || statusChanged

  if (nextStatus === "accepted" && previousStatus !== "accepted") {
    void handleOfferAccepted({
      offerId: id,
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      source: "manual_accept",
    }).catch((error) => {
      console.error("Failed to sync Tripletex order after manual accept:", error)
      void logServerError({
        message: "Failed to sync Tripletex order after manual accept",
        error,
        source: "api",
        route: "PATCH /api/offers/[id]",
        level: "warning",
        companyId: ctx.companyId,
        userId: ctx.userId,
        context: { offerId: id },
      })
    })
  }

  if (shouldLogUpdate) {
    await logOfferActivity({
      offerId: id,
      companyId: ctx.companyId,
      actorUserId: ctx.userId,
      eventType: OFFER_ACTIVITY.UPDATED,
      title: statusChanged ? `Status endret til ${statusLabels[nextStatus] || nextStatus}` : "Tilbud oppdatert",
      description: statusChanged ? `Tilbud «${loggedTitle}»` : `${lineItemCount} ordrelinjer`,
      metadata: {
        status: nextStatus,
        previousStatus,
        lineItemCount,
        activitySource: payload.activitySource || "manual",
      },
    })
  }

  if (existingOffer.customer_id) {
    const hasCustomerUpdates =
      payload.customerName !== undefined ||
      payload.customerEmail !== undefined ||
      payload.customerPhone !== undefined ||
      payload.customerAddress !== undefined ||
      payload.customerPostalCode !== undefined ||
      payload.customerCity !== undefined ||
      payload.customerOrgNumber !== undefined

    const customerUpdatePayload = {
      name: payload.customerName?.trim() || null,
      email: payload.customerEmail?.trim() || null,
      phone: payload.customerPhone?.trim() || null,
      address: payload.customerAddress?.trim() || null,
      postal_code: payload.customerPostalCode?.trim() || null,
      city: payload.customerCity?.trim() || null,
      org_number: payload.customerOrgNumber?.trim() || null,
      updated_at: new Date().toISOString(),
    }

    if (hasCustomerUpdates) {
      const { error: customerUpdateError } = await ctx.supabase
        .from("customers")
        .update(customerUpdatePayload)
        .eq("id", existingOffer.customer_id)
        .eq("company_id", ctx.companyId)

      if (customerUpdateError) {
        return NextResponse.json({ error: customerUpdateError.message }, { status: 400 })
      }
    }
  }

  return NextResponse.json({
    ok: true,
    financialFieldsLocked: isFinanciallyLocked,
    offer: {
      id: data.id,
      amountNok: Number(data.amount_nok || 0),
      subtotalNok: Number(data.subtotal_nok || 0),
      discountNok: Number(data.discount_nok || 0),
      updatedAt: data.updated_at || null,
    },
  })
}
