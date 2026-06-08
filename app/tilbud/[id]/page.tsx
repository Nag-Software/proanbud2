import { notFound } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { createClient } from "@/lib/supabase/server"
import { type OfferLineItem } from "@/lib/tilbud/types"
import { OfferDetailClient } from "./offer-detail-client"

type Params = {
  id: string
}

type ContractState = {
  provider: "docusign"
  status: "draft" | "sent" | "delivered" | "completed" | "declined" | "voided" | "error"
  envelopeId?: string
  externalUrl?: string
  sentAt?: string
  signedAt?: string
  lastError?: string
}

type OfferRecord = {
  id: string
  customer_id: string | null
  title: string | null
  description: string | null
  status: "draft" | "sent" | "accepted" | "rejected" | null
  amount_nok: number | null
  subtotal_nok: number | null
  discount_nok: number | null
  quote_valid_until: string | null
  created_at: string | null
  updated_at: string | null
  sent_at: string | null
  recipient_name: string | null
  recipient_email: string | null
  recipient_phone: string | null
  source_summary: string | null
  line_items: unknown
  analysis_result: unknown
  customers?: {
    name: string | null
    email: string | null
    phone: string | null
    address: string | null
    postal_code: string | null
    city: string | null
    org_number: string | null
  } | null
  projects?: {
    name: string | null
  } | null
}

function extractInvoiceId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") {
    return null
  }

  const record = payload as Record<string, unknown>
  const direct = record.invoiceId
  if (typeof direct === "number" || typeof direct === "string") {
    const parsed = Number(direct)
    return Number.isFinite(parsed) ? parsed : null
  }

  const data = record.data
  if (!data || typeof data !== "object") {
    return null
  }

  const nested = (data as Record<string, unknown>).invoiceId
  if (typeof nested === "number" || typeof nested === "string") {
    const parsed = Number(nested)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function toLineItems(input: unknown): OfferLineItem[] {
  if (!Array.isArray(input)) return []

  return input
    .map((row) => {
      const item = row as Partial<OfferLineItem>
      return {
        id: String(item.id || crypto.randomUUID()),
        subproject: String(item.subproject || "Generelt"),
        title: String(item.title || "Uten navn"),
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
      } satisfies OfferLineItem
    })
    .filter((item) => item.title.trim().length > 0)
}

function readContractState(analysisResult: unknown): ContractState | null {
  if (!analysisResult || typeof analysisResult !== "object") return null
  const contract = (analysisResult as Record<string, unknown>).contract
  if (!contract || typeof contract !== "object") return null

  const value = contract as Record<string, unknown>
  const statusRaw = String(value.status || "draft")
  const status =
    statusRaw === "sent" ||
    statusRaw === "delivered" ||
    statusRaw === "completed" ||
    statusRaw === "declined" ||
    statusRaw === "voided" ||
    statusRaw === "error"
      ? statusRaw
      : "draft"

  return {
    provider: "docusign",
    status,
    envelopeId: value.envelopeId ? String(value.envelopeId) : undefined,
    externalUrl: value.externalUrl ? String(value.externalUrl) : undefined,
    sentAt: value.sentAt ? String(value.sentAt) : undefined,
    signedAt: value.signedAt ? String(value.signedAt) : undefined,
    lastError: value.lastError ? String(value.lastError) : undefined,
  }
}

function formatOfferReference(id: string) {
  const normalized = id.trim()
  if (!normalized) return "UKJENT"

  const firstChunk = normalized.split("-")[0]
  if (firstChunk) {
    return firstChunk.toUpperCase()
  }

  return normalized.slice(0, 8).toUpperCase()
}

export default async function OfferDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    notFound()
  }

  const { data: userRow } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
  if (!userRow?.company_id) {
    notFound()
  }

  const companyId = userRow.company_id

  const [offerResult, tripletexConnection, linkRows, jobRows, invoiceWebhookJobs] = await Promise.all([
    supabase
      .from("offers")
      .select(
        "id, title, description, status, amount_nok, subtotal_nok, discount_nok, quote_valid_until, created_at, updated_at, sent_at, recipient_name, recipient_email, recipient_phone, source_summary, line_items, analysis_result, customer_id, project_id, customers(id, name, email, phone, address, postal_code, city, org_number), projects(id, name)"
      )
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase
      .from("tripletex_connections")
      .select("sync_state")
      .eq("company_id", companyId)
      .maybeSingle(),
    supabase
      .from("external_entity_links")
      .select("entity_type, external_id, external_url, last_synced_at")
      .eq("company_id", companyId)
      .eq("provider", "tripletex")
      .eq("local_id", id)
      .in("entity_type", ["order", "invoice"]),
    supabase
      .from("integration_jobs")
      .select("id, job_type, status, created_at, updated_at, payload, last_error_message")
      .eq("company_id", companyId)
      .eq("provider", "tripletex")
      .or(`payload->>offerId.eq.${id},payload->>projectId.eq.${id},payload->>customerId.eq.${id}`)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("integration_jobs")
      .select("id, job_type, status, created_at, updated_at, payload")
      .eq("company_id", companyId)
      .eq("provider", "tripletex")
      .eq("job_type", "webhook.invoice_paid")
      .eq("status", "completed")
      .order("updated_at", { ascending: false })
      .limit(200),
  ])

  if (!offerResult.data) {
    notFound()
  }

  const offer = offerResult.data as OfferRecord
  const lineItems = toLineItems(offer.line_items)
  const contract = readContractState(offer.analysis_result)
  const customer = offer.customers || null
  const project = offer.projects || null

  const links = (linkRows.data || []) as Array<{
    entity_type: string
    external_id: number
    external_url: string | null
    last_synced_at: string | null
  }>

  const orderLink = links.find((item) => item.entity_type === "order") || null
  const invoiceLink = links.find((item) => item.entity_type === "invoice") || null

  const jobs = (jobRows.data || []) as Array<{
    id: number
    job_type: string
    status: string
    created_at: string | null
    updated_at: string | null
    payload: Record<string, unknown> | null
    last_error_message: string | null
  }>

  const paidWebhookCandidates = (invoiceWebhookJobs.data || []) as Array<{
    updated_at: string | null
    payload: Record<string, unknown> | null
  }>

  const matchingPaidWebhook = invoiceLink
    ? paidWebhookCandidates.find((item) => extractInvoiceId(item.payload) === Number(invoiceLink.external_id))
    : null

  const paymentRegistered = Boolean(matchingPaidWebhook)
  const paymentRegisteredAt = matchingPaidWebhook?.updated_at || null

  return (
    <AppPageShell segments={["Tilbud", `#${formatOfferReference(offer.id)}`]}>
      <OfferDetailClient
        initialOffer={{
          id: offer.id,
          customerId: offer.customer_id || null,
          title: offer.title || "Untitled",
          description: offer.description || "",
          status: offer.status || "draft",
          amountNok: Number(offer.amount_nok || 0),
          subtotalNok: Number(offer.subtotal_nok || 0),
          discountNok: Number(offer.discount_nok || 0),
          quoteValidUntil: offer.quote_valid_until || null,
          createdAt: offer.created_at || null,
          updatedAt: offer.updated_at || null,
          sentAt: offer.sent_at || null,
          recipientName: offer.recipient_name || "",
          recipientEmail: offer.recipient_email || customer?.email || "",
          recipientPhone: offer.recipient_phone || "",
          customerName: customer?.name || "Ukjent kunde",
          customerEmail: customer?.email || "",
          customerPhone: customer?.phone || "",
          customerAddress: customer?.address || "",
          customerPostalCode: customer?.postal_code || "",
          customerCity: customer?.city || "",
          customerOrgNumber: customer?.org_number || "",
          projectName: project?.name || "",
          sourceSummary: offer.source_summary || "",
          lineItems,
          contract,
        }}
        tripletex={{
          connected: Boolean(tripletexConnection.data && tripletexConnection.data.sync_state !== "disconnected"),
          syncState: tripletexConnection.data?.sync_state || "disconnected",
          orderExternalId: orderLink?.external_id || null,
          orderExternalUrl: orderLink?.external_url || null,
          invoiceExternalId: invoiceLink?.external_id || null,
          invoiceExternalUrl: invoiceLink?.external_url || null,
          paymentRegistered,
          paymentRegisteredAt,
        }}
        activity={jobs.map((item) => ({
          id: item.id,
          jobType: item.job_type,
          status: item.status,
          createdAt: item.created_at,
          updatedAt: item.updated_at,
          errorMessage: item.last_error_message,
        }))}
      />
    </AppPageShell>
  )
}
