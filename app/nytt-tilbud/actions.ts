"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"
import { calculateOfferTotals } from "@/lib/tilbud/types"
import { canSendOffers } from "@/lib/roles"
import { logOfferActivity, OFFER_ACTIVITY } from "@/lib/tilbud/offer-activity"
import { resolveOfferSendCompany, sendOfferToCustomer } from "@/lib/tilbud/send-offer"

const sourceDocumentSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  sizeBytes: z.number().min(0),
  type: z.string().trim().optional(),
  storageBucket: z.string().trim().optional(),
  storagePath: z.string().trim().optional(),
  signedUrl: z.string().trim().optional(),
  uploadedAt: z.string().trim().optional(),
  uploadStatus: z.enum(["pending", "uploading", "ready", "failed"]).optional(),
  previewKind: z.enum(["image", "document"]).optional(),
})

const lineItemSchema = z.object({
  id: z.string().trim().min(1),
  subproject: z.string().trim().default("Generelt"),
  title: z.string().trim().min(1),
  description: z.string().trim().default(""),
  reasoning: z.string().trim().optional(),
  quantity: z.number().min(0),
  unit: z.string().trim().min(1),
  supplier: z.string().trim().default("Ukjent"),
  nobb: z.string().trim().optional(),
  supplierSku: z.string().trim().optional(),
  supplierUrl: z.string().trim().optional(),
  unitPriceNok: z.number().min(0),
  markupPercent: z.number().min(0).max(100),
  discountPercent: z.number().min(0).max(100),
})

const analysisSchema = z
  .object({
    summary: z.string().trim().default(""),
    warnings: z.array(z.string().trim()).default([]),
    reasoning: z.string().trim().optional(),
    generatedAt: z.string().trim().default(""),
    model: z.string().trim().default("manual"),
    supplierSnapshots: z
      .array(
        z.object({
          supplier: z.string(),
          product: z.string(),
          unit: z.string(),
          unitPriceNok: z.number(),
          sourceUrl: z.string().optional(),
          fetchedAt: z.string(),
        })
      )
      .default([]),
  })
  .nullable()

function normalizeAnalysisResult(value: z.infer<typeof analysisSchema>) {
  if (value) {
    return value
  }

  return {
    summary: "Manuell kalkyle uten AI-analyse",
    warnings: [],
    reasoning: "",
    generatedAt: new Date().toISOString(),
    model: "manual",
    supplierSnapshots: [],
  }
}

const offerFieldsSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(2, "Gi tilbudet en tittel"),
  description: z.string().trim().default(""),
  projectId: z.string().uuid("Prosjekt må velges"),
  sourceSummary: z.string().trim().default(""),
  sourceDocuments: z.array(sourceDocumentSchema).default([]),
  lineItems: z.array(lineItemSchema).default([]),
  analysisResult: analysisSchema.default(null),
  sendDirectlyToCustomer: z.boolean().default(false),
  recipientName: z.string().trim().default(""),
  recipientEmail: z.string().trim().default(""),
  recipientPhone: z.string().trim().default(""),
  validityDays: z.number().int().min(1).max(365).default(30),
  pricingModel: z.enum(["fixed", "time_materials", "unit_price", "mixed"]).optional(),
  contractBasis: z.enum(["ns8405", "ns8407", "custom", "none"]).optional(),
  markupPercent: z.number().min(0).max(200).optional(),
  paymentSchedule: z
    .array(
      z.object({
        label: z.string().trim().min(1),
        percent: z.number().min(0).max(100),
        dueDescription: z.string().trim().optional(),
      })
    )
    .optional(),
})

type SaveOfferInput = z.infer<typeof offerFieldsSchema>

function recipientIssues(value: SaveOfferInput) {
  const issues: Array<{ path: string[]; message: string }> = []

  if (value.sendDirectlyToCustomer && !value.recipientEmail) {
    issues.push({
      path: ["recipientEmail"],
      message: "Mottaker e-post må fylles ut ved direkte sending",
    })
  }

  if (value.recipientEmail) {
    const emailCheck = z.string().email().safeParse(value.recipientEmail)
    if (!emailCheck.success) {
      issues.push({
        path: ["recipientEmail"],
        message: "Mottaker e-post er ugyldig",
      })
    }
  }

  return issues
}

// Utkast kan lagres halvveis: tittel + prosjekt er nok, prislinjer og full
// beskrivelse kan komme senere. Tomme line_items er trygt nedstrøms (totals
// blir 0, tilbudssiden håndterer tomme lister, og send/PDF er sperret der).
const draftOfferSchema = offerFieldsSchema.superRefine((value, ctx) => {
  for (const issue of recipientIssues(value)) {
    ctx.addIssue({ code: "custom", ...issue })
  }
})

// Ferdigstilling/sending krever komplett innhold.
const completeOfferSchema = offerFieldsSchema.superRefine((value, ctx) => {
  for (const issue of recipientIssues(value)) {
    ctx.addIssue({ code: "custom", ...issue })
  }

  if (value.description.length < 20) {
    ctx.addIssue({
      code: "custom",
      path: ["description"],
      message: "Beskriv jobben med minst 20 tegn før tilbudet sendes",
    })
  }

  if (value.lineItems.length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["lineItems"],
      message: "Tilbudet må ha minst én prislinje før det kan sendes",
    })
  }
})

type PersistedOfferResult = {
  id: string
  status: "draft" | "sent"
  companyId: string
  projectId: string | null
  customerId: string | null
}

async function resolveCompanyId() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { data: userRow, error: userError } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .single()

  if (userError || !userRow?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  if (!canSendOffers(userRow.role)) {
    throw new Error("Du har ikke tilgang til å opprette eller sende tilbud")
  }

  return { supabase, companyId: userRow.company_id, userId: user.id }
}

async function validateProjectAndCustomer(
  input: SaveOfferInput,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id, customer_id")
    .eq("id", input.projectId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (projectError || !project) {
    throw new Error("Prosjektet finnes ikke i bedriften")
  }

  const customerId = project.customer_id

  if (customerId) {
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .eq("company_id", companyId)
      .maybeSingle()

    if (customerError || !customer) {
      throw new Error("Kunden finnes ikke i bedriften")
    }
  }

  return { projectId: project.id, customerId: customerId ?? null }
}

function toOfferRow(input: SaveOfferInput, companyId: string, status: "draft" | "sent") {
  const totals = calculateOfferTotals(input.lineItems)
  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + input.validityDays)

  return {
    company_id: companyId,
    title: input.title,
    description: input.description,
    amount_nok: Math.round(totals.totalNok),
    subtotal_nok: totals.subtotalNok,
    discount_nok: totals.discountNok,
    line_items: input.lineItems,
    analysis_result: normalizeAnalysisResult(input.analysisResult),
    source_summary: input.sourceSummary,
    source_documents: input.sourceDocuments,
    // Tilbud sendes via e-post. Kontrakt sendes separat via DocuSign.
    send_to_customer_direct: false,
    recipient_name: input.recipientName || null,
    recipient_email: input.recipientEmail || null,
    recipient_phone: input.recipientPhone || null,
    quote_valid_until: validUntil.toISOString().slice(0, 10),
    sent_at: status === "sent" ? new Date().toISOString() : null,
    status,
    pricing_model: input.pricingModel || "fixed",
    contract_basis: input.contractBasis || "none",
    markup_percent: Number(input.markupPercent ?? 0),
    payment_schedule: input.paymentSchedule || [],
  }
}

async function persistOffer(input: SaveOfferInput, status: "draft" | "sent"): Promise<PersistedOfferResult> {
  const { supabase, companyId, userId } = await resolveCompanyId()
  const { projectId, customerId } = await validateProjectAndCustomer(input, companyId, supabase)
  const row = toOfferRow(input, companyId, status)
  const hasAiAnalysis = Boolean(input.analysisResult?.model && input.analysisResult.model !== "manual")

  if (input.id) {
    const { data, error } = await supabase
      .from("offers")
      .update({
        ...row,
        project_id: projectId,
        customer_id: customerId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("company_id", companyId)
      .select("id, project_id")
      .single()

    if (error || !data?.id) {
      throw new Error(
        `Kunne ikke oppdatere tilbud: ${error?.message || "ukjent feil"}. Husk å kjøre db/07_nytt_tilbud_workflow.sql.`
      )
    }

    if (hasAiAnalysis) {
      await logOfferActivity({
        offerId: data.id,
        companyId,
        actorUserId: userId,
        eventType: OFFER_ACTIVITY.AI_ANALYSIS,
        title: "KI-kalkyle lagret",
        description: input.title,
        metadata: { lineItemCount: input.lineItems.length },
      })
    }

    revalidatePath("/nytt-tilbud")
    revalidatePath(`/prosjekter/${data.project_id}`)

    return {
      id: data.id,
      status,
      companyId,
      projectId,
      customerId,
    }
  }

  const { data, error } = await supabase
    .from("offers")
    .insert({
      ...row,
      project_id: projectId,
      customer_id: customerId,
    })
    .select("id, project_id")
    .single()

  if (error || !data?.id) {
    throw new Error(
      `Kunne ikke lagre tilbud: ${error?.message || "ukjent feil"}. Husk å kjøre db/07_nytt_tilbud_workflow.sql.`
    )
  }

  await logOfferActivity({
    offerId: data.id,
    companyId,
    actorUserId: userId,
    eventType: OFFER_ACTIVITY.CREATED,
    title: "Tilbud opprettet",
    description: input.title,
    metadata: { lineItemCount: input.lineItems.length },
  })

  if (hasAiAnalysis) {
    await logOfferActivity({
      offerId: data.id,
      companyId,
      actorUserId: userId,
      eventType: OFFER_ACTIVITY.AI_ANALYSIS,
      title: "KI-kalkyle generert",
      description: input.title,
      metadata: { lineItemCount: input.lineItems.length },
    })
  }

  revalidatePath("/nytt-tilbud")
  revalidatePath(`/prosjekter/${data.project_id}`)

  return {
    id: data.id,
    status,
    companyId,
    projectId,
    customerId,
  }
}

export type OfferActionResult = { ok: true; data: PersistedOfferResult } | { ok: false; error: string }

export async function saveOfferDraftAction(input: unknown): Promise<OfferActionResult> {
  const parsed = draftOfferSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Ugyldige tilbudsdata" }
  }

  try {
    const data = await persistOffer(parsed.data, "draft")
    return { ok: true, data }
  } catch (error) {
    void logServerError({
      message: "Failed to save offer draft",
      error,
      source: "action",
      route: "app/nytt-tilbud/actions.ts#saveOfferDraftAction",
      context: { offerId: parsed.data.id || null, projectId: parsed.data.projectId },
    })
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Kunne ikke lagre utkastet. Prøv igjen.",
    }
  }
}

export async function sendOfferAction(input: unknown): Promise<OfferActionResult> {
  const parsed = completeOfferSchema.safeParse(input)

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || "Ugyldige tilbudsdata" }
  }

  try {
    const result = await persistOffer(parsed.data, "draft")
    const context = await resolveOfferSendCompany()

    if (!context) {
      return { ok: false, error: "Du må være logget inn for å sende tilbud" }
    }

    await sendOfferToCustomer({
      offerId: result.id,
      companyId: context.companyId,
      company: context.company,
      recipientName: parsed.data.recipientName,
      recipientEmail: parsed.data.recipientEmail,
      recipientPhone: parsed.data.recipientPhone,
      message: parsed.data.sourceSummary,
      actorUserId: context.userId,
    })

    revalidatePath(`/tilbud/${result.id}`)
    if (result.projectId) {
      revalidatePath(`/prosjekter/${result.projectId}`)
    }

    return { ok: true, data: result }
  } catch (error) {
    void logServerError({
      message: "Failed to send offer",
      error,
      source: "action",
      route: "app/nytt-tilbud/actions.ts#sendOfferAction",
      context: { offerId: parsed.data.id || null, projectId: parsed.data.projectId },
    })
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Kunne ikke sende tilbudet. Prøv igjen.",
    }
  }
}
