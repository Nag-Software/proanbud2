"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { calculateOfferTotals } from "@/lib/tilbud/types"

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

const saveOfferSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().trim().min(2, "Tittel mangler"),
    description: z.string().trim().min(20, "Beskrivelse må være minst 20 tegn"),
    assignmentMode: z.enum(["project", "customer"]),
    projectId: z.string().uuid().nullable(),
    customerId: z.string().uuid(),
    sourceSummary: z.string().trim().default(""),
    sourceDocuments: z.array(sourceDocumentSchema).default([]),
    lineItems: z.array(lineItemSchema).min(1, "Tilbudet må inneholde minst ett produkt"),
    analysisResult: analysisSchema.default(null),
    sendDirectlyToCustomer: z.boolean().default(false),
    recipientName: z.string().trim().default(""),
    recipientEmail: z.string().trim().default(""),
    recipientPhone: z.string().trim().default(""),
    validityDays: z.number().int().min(1).max(365).default(30),
  })
  .superRefine((value, ctx) => {
    if (value.assignmentMode === "project" && !value.projectId) {
      ctx.addIssue({
        code: "custom",
        path: ["projectId"],
        message: "Prosjekt må velges",
      })
    }

    if (value.sendDirectlyToCustomer && !value.recipientEmail) {
      ctx.addIssue({
        code: "custom",
        path: ["recipientEmail"],
        message: "Mottaker e-post må fylles ut ved direkte sending",
      })
    }

    if (value.recipientEmail) {
      const emailCheck = z.string().email().safeParse(value.recipientEmail)
      if (!emailCheck.success) {
        ctx.addIssue({
          code: "custom",
          path: ["recipientEmail"],
          message: "Mottaker e-post er ugyldig",
        })
      }
    }
  })

type SaveOfferInput = z.infer<typeof saveOfferSchema>

type PersistedOfferResult = {
  id: string
  status: "draft" | "sent"
  companyId: string
  projectId: string | null
  customerId: string
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
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (userError || !userRow?.company_id) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  return { supabase, companyId: userRow.company_id }
}

async function validateProjectAndCustomer(
  input: SaveOfferInput,
  companyId: string,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  let projectId = input.projectId
  let customerId = input.customerId

  if (input.assignmentMode === "project") {
    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, customer_id")
      .eq("id", input.projectId)
      .eq("company_id", companyId)
      .maybeSingle()

    if (projectError || !project) {
      throw new Error("Prosjektet finnes ikke i bedriften")
    }

    projectId = project.id
    customerId = customerId || project.customer_id

    if (!customerId) {
      throw new Error("Prosjektet mangler kunde. Velg en kunde for tilbudet.")
    }
  } else {
    projectId = null
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("id")
    .eq("id", customerId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (customerError || !customer) {
    throw new Error("Kunden finnes ikke i bedriften")
  }

  return { projectId, customerId }
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
    // Direct offer sending is disabled. Contracts must be sent from the offer detail page.
    send_to_customer_direct: false,
    recipient_name: input.recipientName || null,
    recipient_email: input.recipientEmail || null,
    recipient_phone: input.recipientPhone || null,
    quote_valid_until: validUntil.toISOString().slice(0, 10),
    sent_at: status === "sent" ? new Date().toISOString() : null,
    status,
  }
}

async function persistOffer(input: SaveOfferInput, status: "draft" | "sent"): Promise<PersistedOfferResult> {
  const { supabase, companyId } = await resolveCompanyId()
  const { projectId, customerId } = await validateProjectAndCustomer(input, companyId, supabase)
  const row = toOfferRow(input, companyId, status)

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

    revalidatePath("/tilbud")
    revalidatePath("/nytt-tilbud")

    if (data.project_id) {
      revalidatePath(`/prosjekter/${data.project_id}`)
    }

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

  revalidatePath("/tilbud")
  revalidatePath("/nytt-tilbud")

  if (data.project_id) {
    revalidatePath(`/prosjekter/${data.project_id}`)
  }

  return {
    id: data.id,
    status,
    companyId,
    projectId,
    customerId,
  }
}

export async function saveOfferDraftAction(input: unknown) {
  const parsed = saveOfferSchema.safeParse(input)

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message || "Ugyldige tilbudsdata")
  }

  return persistOffer(parsed.data, "draft")
}

export async function sendOfferAction(input: unknown) {
  void input
  throw new Error("Direkte sending av tilbud er deaktivert. Send kontrakt fra tilbudssiden.")
}
