import { NextResponse } from "next/server"

import { generateProjectSummary, mergeAnalysisSummary, readProjectSummaryFromAnalysis } from "@/lib/tilbud/project-summary"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { createClient } from "@/lib/supabase/server"
import { type OfferLineItem } from "@/lib/tilbud/types"

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

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
  if (!userRow?.company_id) {
    return NextResponse.json({ error: "Company context missing" }, { status: 400 })
  }

  const { id } = await params
  const { data: offer, error } = await supabase
    .from("offers")
    .select("id, title, description, analysis_result, line_items, projects(name)")
    .eq("id", id)
    .eq("company_id", userRow.company_id)
    .maybeSingle()

  if (error || !offer) {
    return NextResponse.json({ error: error?.message || "Tilbudet finnes ikke" }, { status: 404 })
  }

  const existingSummary = readProjectSummaryFromAnalysis(offer.analysis_result)
  if (existingSummary) {
    return NextResponse.json({ summary: existingSummary, generated: false })
  }

  const project = normalizeRelatedRow(offer.projects)
  const lineItems = normalizeLineItems(offer.line_items)
  const summary = await generateProjectSummary({
    title: offer.title || "Tilbud",
    description: offer.description || "",
    projectName: project?.name,
    lineItems,
  })

  const { error: updateError } = await supabase
    .from("offers")
    .update({
      analysis_result: mergeAnalysisSummary(offer.analysis_result, summary),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("company_id", userRow.company_id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  await logOfferActivity({
    offerId: id,
    companyId: userRow.company_id,
    actorUserId: user.id,
    eventType: OFFER_ACTIVITY.PROJECT_SUMMARY,
    title: "Prosjektbeskrivelse generert",
    description: summary.slice(0, 240),
  })

  return NextResponse.json({ summary, generated: true })
}
