import { Buffer } from "buffer"
import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { enqueueIntegrationJob } from "@/lib/integrations/tripletex/jobs"
import { getDocusignAuthContext } from "@/lib/integrations/docusign/client"
import { type OfferLineItem } from "@/lib/tilbud/types"

async function resolveContext() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
  if (!userRow?.company_id) {
    return { error: NextResponse.json({ error: "Company context missing" }, { status: 400 }) }
  }

  return { supabase, companyId: userRow.company_id }
}

function toLineItems(input: unknown): OfferLineItem[] {
  if (!Array.isArray(input)) return []
  return input as OfferLineItem[]
}

function buildDocument(offer: {
  id: string
  title: string | null
  description: string | null
  amount_nok: number | null
  customer_name: string
  project_name: string
  line_items: OfferLineItem[]
}) {
  const rows = offer.line_items
    .map((item, index) => {
      const qty = Number(item.quantity || 0)
      const unitPrice = Number(item.unitPriceNok || 0)
      const discount = Number(item.discountPercent || 0)
      const total = qty * unitPrice * (1 - discount / 100)
      return `${index + 1}. ${item.title} | ${qty} ${item.unit} | ${unitPrice.toLocaleString("no-NO")} NOK | ${total.toLocaleString("no-NO")} NOK`
    })
    .join("\n")

  return [
    `Kontrakt for tilbud #${offer.id}`,
    "",
    `Tilbud: ${offer.title || "Uten tittel"}`,
    `Kunde: ${offer.customer_name}`,
    `Prosjekt: ${offer.project_name || "Ikke koblet"}`,
    `Total: ${(offer.amount_nok || 0).toLocaleString("no-NO")} NOK`,
    "",
    "Beskrivelse:",
    offer.description || "-",
    "",
    "Linjeinnhold:",
    rows || "Ingen linjer",
    "",
    "Dette dokumentet sendes elektronisk for signering via DocuSign.",
  ].join("\n")
}

function mergeContract(analysisResult: unknown, contract: Record<string, unknown>) {
  const base = analysisResult && typeof analysisResult === "object" ? { ...(analysisResult as Record<string, unknown>) } : {}
  return {
    ...base,
    contract,
  }
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveContext()
  if ("error" in ctx) return ctx.error

  const { id } = await params

  const { data: offer } = await ctx.supabase
    .from("offers")
    .select(
      "id, title, description, amount_nok, analysis_result, line_items, recipient_name, recipient_email, recipient_phone, customer_id, project_id, customers(name, email, phone), projects(name)"
    )
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .maybeSingle()

  if (!offer) {
    return NextResponse.json({ error: "Offer not found" }, { status: 404 })
  }

  const customerRecord = offer.customers as any
  const recipientEmail = String(offer.recipient_email || customerRecord?.email || "").trim()
  if (!recipientEmail) {
    return NextResponse.json({ error: "Mottaker e-post mangler på tilbudet." }, { status: 400 })
  }

  const recipientName = String(offer.recipient_name || customerRecord?.name || "Mottaker")
  let docusignAccessToken = ""
  let docusignAccountId = ""
  let docusignApiBase = ""

  try {
    const authContext = await getDocusignAuthContext()
    docusignAccessToken = authContext.accessToken
    docusignAccountId = authContext.accountId
    docusignApiBase = authContext.baseUri
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "DocuSign auth feilet",
      },
      { status: 400 }
    )
  }

  const lineItems = toLineItems(offer.line_items)
  const customerName = ((offer.customers as any)?.name as string) || "Ukjent kunde"
  const projectName = ((offer.projects as any)?.name as string) || ""
  const documentText = buildDocument({
    id: offer.id,
    title: offer.title,
    description: offer.description,
    amount_nok: offer.amount_nok,
    customer_name: customerName,
    project_name: projectName,
    line_items: lineItems,
  })

  const documentBase64 = Buffer.from(documentText, "utf8").toString("base64")

  const envelopePayload = {
    emailSubject: `Signering av tilbud ${offer.title || offer.id}`,
    documents: [
      {
        documentBase64,
        name: `Tilbud-${offer.id}.txt`,
        fileExtension: "txt",
        documentId: "1",
      },
    ],
    recipients: {
      signers: [
        {
          email: recipientEmail,
          name: recipientName,
          recipientId: "1",
          routingOrder: "1",
          tabs: {
            signHereTabs: [
              {
                anchorString: "DocuSign.",
                anchorUnits: "pixels",
                anchorYOffset: "10",
                anchorXOffset: "0",
              },
            ],
          },
        },
      ],
    },
    customFields: {
      textCustomFields: [
        {
          name: "offerId",
          value: offer.id,
          required: "false",
          show: "false",
        },
        {
          name: "companyId",
          value: ctx.companyId,
          required: "false",
          show: "false",
        },
      ],
    },
    status: "sent",
  }

  const response = await fetch(`${docusignApiBase}/restapi/v2.1/accounts/${docusignAccountId}/envelopes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${docusignAccessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(envelopePayload),
  })

  const result = await response.json().catch(() => ({}))

  if (!response.ok) {
    const message = typeof result?.message === "string" ? result.message : "DocuSign request failed"
    return NextResponse.json({ error: message }, { status: response.status })
  }

  const envelopeId = String(result?.envelopeId || "")
  const envelopeStatus = String(result?.status || "sent")
  const envelopeUri = typeof result?.uri === "string" ? `${docusignApiBase}${result.uri}` : null

  const contract = {
    provider: "docusign",
    status: envelopeStatus,
    envelopeId,
    externalUrl: envelopeUri,
    sentAt: new Date().toISOString(),
    signedAt: null,
    lastError: null,
  }

  const updatedAnalysis = mergeContract(offer.analysis_result, contract)

  const { error: updateError } = await ctx.supabase
    .from("offers")
    .update({
      analysis_result: updatedAnalysis,
      status: "sent",
      sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", offer.id)
    .eq("company_id", ctx.companyId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 })
  }

  // Keep Tripletex order sync fully automatic once a contract is sent.
  if (offer.customer_id && offer.project_id) {
    const { data: connection } = await ctx.supabase
      .from("tripletex_connections")
      .select("sync_state")
      .eq("company_id", ctx.companyId)
      .maybeSingle()

    if (connection && connection.sync_state !== "disconnected") {
      const customerId = String(offer.customer_id)
      const projectId = String(offer.project_id)

      await enqueueIntegrationJob({
        companyId: ctx.companyId,
        jobType: "customer.upsert",
        payload: { customerId },
        idempotencyKey: `offer:${offer.id}:customer:${customerId}`,
      })

      await enqueueIntegrationJob({
        companyId: ctx.companyId,
        jobType: "project.upsert",
        payload: { projectId },
        idempotencyKey: `offer:${offer.id}:project:${projectId}`,
      })

      await enqueueIntegrationJob({
        companyId: ctx.companyId,
        jobType: "order.create_from_offer",
        payload: { offerId: offer.id, customerId, projectId },
        idempotencyKey: `offer:${offer.id}:order:contract-send`,
      })
    }
  }

  return NextResponse.json({ ok: true, contract })
}
