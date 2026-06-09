import { createAdminClient } from "@/lib/supabase/admin"
import {
  COMPANY_BASIC_SELECT,
  mapCompanyRowToOfferContext,
  normalizeRelatedCompanyRow,
  type CompanyProfileRow,
} from "@/lib/tilbud/company-profile"
import { computeValidityDays, formatOfferReference } from "@/lib/tilbud/offer-document"
import { readProjectSummaryFromAnalysis } from "@/lib/tilbud/project-summary"
import { type OfferCompanyContext, type OfferLineItem } from "@/lib/tilbud/types"
import { APP_BASE_URL } from "@/lib/constants"

export function generatePublicOfferSlug() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString("base64url")
}

export function buildPublicOfferUrl(slug: string, options?: { chat?: boolean }) {
  const base = `${APP_BASE_URL}/tilbudsvisning/${slug}`
  return options?.chat ? `${base}?chat=1` : base
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

function normalizeRelatedRow<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] || null
  }
  return value || null
}

export type PublicOfferRecord = {
  id: string
  companyId: string
  customerId: string
  publicSlug: string
  title: string
  description: string
  projectSummary: string
  sourceSummary: string
  status: "draft" | "sent" | "accepted" | "rejected"
  amountNok: number
  quoteValidUntil: string | null
  createdAt: string | null
  sentAt: string | null
  recipientName: string
  recipientEmail: string
  lineItems: OfferLineItem[]
  company: OfferCompanyContext
  projectName: string
  customer: {
    name: string
    email: string | null
    phone: string | null
    address: string | null
    city: string | null
    orgNumber: string | null
  }
  validityDays: number
  offerReference: string
  isExpired: boolean
  canRespond: boolean
}

type RawOfferRow = {
  id: string
  company_id: string
  customer_id: string | null
  public_slug: string | null
  title: string | null
  description: string | null
  source_summary: string | null
  status: string | null
  amount_nok: number | null
  quote_valid_until: string | null
  created_at: string | null
  sent_at: string | null
  recipient_name: string | null
  recipient_email: string | null
  line_items: unknown
  analysis_result: unknown
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
    | { name: string | null }
    | { name: string | null }[]
    | null
  companies?:
    | CompanyProfileRow
    | CompanyProfileRow[]
    | null
}

export function mapPublicOfferRow(row: RawOfferRow): PublicOfferRecord | null {
  if (!row.public_slug || !row.customer_id) return null

  const customer = normalizeRelatedRow(row.customers)
  const project = normalizeRelatedRow(row.projects)
  const companyEntity = normalizeRelatedCompanyRow(row.companies)
  const status = (row.status || "draft") as PublicOfferRecord["status"]
  const quoteValidUntil = row.quote_valid_until || null
  const validityDays = computeValidityDays(row.created_at, quoteValidUntil)
  const isExpired =
    status === "sent" &&
    Boolean(quoteValidUntil) &&
    new Date(quoteValidUntil!).getTime() < Date.now()

  return {
    id: row.id,
    companyId: row.company_id,
    customerId: row.customer_id,
    publicSlug: row.public_slug,
    title: row.title || "Tilbud",
    description: row.description || "",
    projectSummary: readProjectSummaryFromAnalysis(row.analysis_result),
    sourceSummary: row.source_summary || "",
    status,
    amountNok: Number(row.amount_nok || 0),
    quoteValidUntil,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    recipientName: row.recipient_name || customer?.name || "Kunde",
    recipientEmail: row.recipient_email || customer?.email || "",
    lineItems: normalizeLineItems(row.line_items),
    company:
      mapCompanyRowToOfferContext(row.company_id, companyEntity) ||
      ({
        id: row.company_id,
        name: null,
        orgNumber: null,
      } satisfies OfferCompanyContext),
    projectName: project?.name || "",
    customer: {
      name: customer?.name || row.recipient_name || "Kunde",
      email: customer?.email || row.recipient_email || null,
      phone: customer?.phone || null,
      address: customer?.address || null,
      city: customer?.city || null,
      orgNumber: customer?.org_number || null,
    },
    validityDays,
    offerReference: formatOfferReference(row.id),
    isExpired,
    canRespond: status === "sent" && !isExpired,
  }
}

export async function fetchPublicOfferBySlug(slug: string) {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from("offers")
    .select(
      "id, company_id, customer_id, public_slug, title, description, source_summary, status, amount_nok, quote_valid_until, created_at, sent_at, recipient_name, recipient_email, line_items, analysis_result, customers(name, email, phone, address, city, org_number), projects(name), companies(" +
        COMPANY_BASIC_SELECT +
        ")"
    )
    .eq("public_slug", slug)
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return mapPublicOfferRow(data as unknown as RawOfferRow)
}

export async function ensureOfferPublicSlug(offerId: string, companyId: string) {
  const admin = createAdminClient()

  const { data: existing } = await admin
    .from("offers")
    .select("public_slug")
    .eq("id", offerId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (existing?.public_slug) {
    return String(existing.public_slug)
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = generatePublicOfferSlug()
    const { data, error } = await admin
      .from("offers")
      .update({ public_slug: slug, updated_at: new Date().toISOString() })
      .eq("id", offerId)
      .eq("company_id", companyId)
      .is("public_slug", null)
      .select("public_slug")
      .maybeSingle()

    if (!error && data?.public_slug) {
      return String(data.public_slug)
    }

    const { data: reloaded } = await admin.from("offers").select("public_slug").eq("id", offerId).maybeSingle()
    if (reloaded?.public_slug) {
      return String(reloaded.public_slug)
    }
  }

  throw new Error("Kunne ikke opprette offentlig tilbudslenke")
}
