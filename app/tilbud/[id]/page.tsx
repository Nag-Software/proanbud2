import { notFound } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { fetchOfferCompanyContext } from "@/lib/tilbud/company-profile"
import { readProjectSummaryFromAnalysis } from "@/lib/tilbud/project-summary"
import { fetchOfferTripletexSyncStatus } from "@/lib/integrations/tripletex/sync"
import { fetchOfferActivity } from "@/lib/tilbud/offer-activity"
import { createClient } from "@/lib/supabase/server"
import { type OfferLineItem, type OfferSourceDocument } from "@/lib/tilbud/types"
import { OfferDetailClient } from "./offer-detail-client"

type Params = {
  id: string
}

type ContractState = {
  provider: "docusign" | "tripletex"
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
  project_id: string | null
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
  source_documents: unknown
  line_items: unknown
  analysis_result: unknown
  customers?:
    | {
        name: string | null
        email: string | null
        phone: string | null
        address: string | null
        postal_code: string | null
        city: string | null
        org_number: string | null
      }
    | {
        name: string | null
        email: string | null
        phone: string | null
        address: string | null
        postal_code: string | null
        city: string | null
        org_number: string | null
      }[]
    | null
  projects?:
    | {
        name: string | null
        customer_id: string | null
        customers?:
          | {
              name: string | null
              email: string | null
              phone: string | null
              address: string | null
              postal_code: string | null
              city: string | null
              org_number: string | null
            }
          | {
              name: string | null
              email: string | null
              phone: string | null
              address: string | null
              postal_code: string | null
              city: string | null
              org_number: string | null
            }[]
          | null
      }
    | {
        name: string | null
        customer_id: string | null
        customers?:
          | {
              name: string | null
              email: string | null
              phone: string | null
              address: string | null
              postal_code: string | null
              city: string | null
              org_number: string | null
            }
          | {
              name: string | null
              email: string | null
              phone: string | null
              address: string | null
              postal_code: string | null
              city: string | null
              org_number: string | null
            }[]
          | null
      }[]
    | null
}

function normalizeRelatedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] || null
  }

  return value || null
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

function toSourceDocuments(input: unknown): OfferSourceDocument[] {
  if (!Array.isArray(input)) return []

  return input
    .map((row) => {
      const item = row as Partial<OfferSourceDocument>
      return {
        id: String(item.id || crypto.randomUUID()),
        name: String(item.name || "Uten navn"),
        sizeBytes: Number(item.sizeBytes || 0),
        type: item.type ? String(item.type) : undefined,
        storageBucket: item.storageBucket ? String(item.storageBucket) : undefined,
        storagePath: item.storagePath ? String(item.storagePath) : undefined,
        signedUrl: item.signedUrl ? String(item.signedUrl) : undefined,
        uploadedAt: item.uploadedAt ? String(item.uploadedAt) : undefined,
        uploadStatus: item.uploadStatus,
        previewKind: item.previewKind,
      } satisfies OfferSourceDocument
    })
    .filter((item) => item.name.trim().length > 0)
}

async function refreshSourceDocumentUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  documents: OfferSourceDocument[]
) {
  return Promise.all(
    documents.map(async (document) => {
      if (!document.storageBucket || !document.storagePath) {
        return document
      }

      const { data, error } = await supabase.storage
        .from(document.storageBucket)
        .createSignedUrl(document.storagePath, 60 * 60 * 24)

      if (error || !data?.signedUrl) {
        return document
      }

      return {
        ...document,
        signedUrl: data.signedUrl,
      }
    })
  )
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
    provider: value.provider === "tripletex" ? "tripletex" : "docusign",
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

  const company = await fetchOfferCompanyContext(supabase, user.id)
  if (!company) {
    notFound()
  }

  const companyId = company.id

  const [offerResult, activityRows, companyRow] = await Promise.all([
    supabase
      .from("offers")
      .select(
        "id, title, description, status, amount_nok, subtotal_nok, discount_nok, quote_valid_until, created_at, updated_at, sent_at, recipient_name, recipient_email, recipient_phone, source_summary, source_documents, line_items, analysis_result, customer_id, project_id, customers(id, name, email, phone, address, postal_code, city, org_number), projects(id, name, customer_id, customers(id, name, email, phone, address, postal_code, city, org_number))"
      )
      .eq("id", id)
      .eq("company_id", companyId)
      .maybeSingle(),
    fetchOfferActivity(id, companyId),
    supabase.from("companies").select("contract_provider").eq("id", companyId).maybeSingle(),
  ])

  if (!offerResult.data) {
    notFound()
  }

  const offer = offerResult.data as OfferRecord
  const tripletexSync = await fetchOfferTripletexSyncStatus(
    companyId,
    offer.id,
    offer.customer_id,
    offer.project_id
  ).catch(() => null)
  const lineItems = toLineItems(offer.line_items)
  const contract = readContractState(offer.analysis_result)
  const project = normalizeRelatedRow(offer.projects)
  const customer = normalizeRelatedRow(offer.customers) || normalizeRelatedRow(project?.customers)
  const resolvedCustomerId = offer.customer_id || project?.customer_id || null
  const sourceDocuments = await refreshSourceDocumentUrls(supabase, toSourceDocuments(offer.source_documents))
  const projectSummary = readProjectSummaryFromAnalysis(offer.analysis_result)

  return (
    <AppPageShell segments={["Tilbud", `#${formatOfferReference(offer.id)}`]}>
      <OfferDetailClient
        linkedCustomer={{
          id: resolvedCustomerId,
          name: customer?.name || "Ukjent kunde",
          email: customer?.email || "",
          phone: customer?.phone || "",
          address: customer?.address || "",
          postalCode: customer?.postal_code || "",
          city: customer?.city || "",
          orgNumber: customer?.org_number || "",
        }}
        initialOffer={{
          id: offer.id,
          title: offer.title || "Untitled",
          description: offer.description || "",
          projectSummary,
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
          projectName: project?.name || "",
          sourceSummary: offer.source_summary || "",
          sourceDocuments,
          lineItems,
          contract,
        }}
        activity={activityRows}
        company={company}
        contractProvider={(companyRow.data?.contract_provider as "docusign" | "tripletex" | null) || "docusign"}
        tripletexSync={tripletexSync}
      />
    </AppPageShell>
  )
}
