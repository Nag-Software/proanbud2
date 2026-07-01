import { createAdminClient } from "@/lib/supabase/admin"
import {
  COMPANY_BASIC_SELECT,
  COMPANY_PROFILE_SELECT,
  mapCompanyRowToOfferContext,
  normalizeRelatedCompanyRow,
  type CompanyProfileRow,
} from "@/lib/tilbud/company-profile"
import {
  computeValidityDays,
  formatOfferReference,
  type OfferDocumentAcceptance,
  type OfferDocumentData,
} from "@/lib/tilbud/offer-document"
import { readProjectSummaryFromAnalysis } from "@/lib/tilbud/project-summary"
import {
  toContractBasis,
  toPricingModel,
  type OfferCompanyContext,
  type OfferContractBasis,
  type OfferLineItem,
  type OfferPaymentScheduleEntry,
  type OfferPricingModel,
} from "@/lib/tilbud/types"
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
        supplier: "",
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
    postalCode: string | null
    city: string | null
    orgNumber: string | null
  }
  validityDays: number
  offerReference: string
  isExpired: boolean
  canRespond: boolean
  paymentSchedule: OfferPaymentScheduleEntry[]
  pricingModel: OfferPricingModel | null
  contractBasis: OfferContractBasis | null
  /** Digital acceptance evidence — set when the customer accepted with a one-time code. */
  acceptance: OfferDocumentAcceptance | null
  /** Frozen document content captured at acceptance time; render from this when present. */
  acceptedSnapshot: OfferDocumentData | null
}

type RawCustomerRow = {
  name: string | null
  email: string | null
  phone: string | null
  address: string | null
  postal_code?: string | null
  city: string | null
  org_number: string | null
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
  pricing_model?: string | null
  contract_basis?: string | null
  payment_schedule?: unknown
  accepted_at?: string | null
  accepted_by_name?: string | null
  accepted_email?: string | null
  accepted_method?: string | null
  accepted_document_sha256?: string | null
  accepted_snapshot?: unknown
  customers?: RawCustomerRow | RawCustomerRow[] | null
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
      postalCode: customer?.postal_code || null,
      city: customer?.city || null,
      orgNumber: customer?.org_number || null,
    },
    validityDays,
    offerReference: formatOfferReference(row.id),
    isExpired,
    canRespond: status === "sent" && !isExpired,
    paymentSchedule: Array.isArray(row.payment_schedule)
      ? (row.payment_schedule as OfferPaymentScheduleEntry[])
      : [],
    pricingModel: toPricingModel(row.pricing_model),
    contractBasis: toContractBasis(row.contract_basis),
    acceptance:
      status === "accepted" && row.accepted_at && row.accepted_by_name && row.accepted_method === "email_otp"
        ? {
            name: row.accepted_by_name,
            email: row.accepted_email || "",
            acceptedAt: row.accepted_at,
            method: "email_otp",
            documentSha256: row.accepted_document_sha256 || "",
          }
        : null,
    acceptedSnapshot: isValidAcceptedSnapshot(row.accepted_snapshot) ? row.accepted_snapshot : null,
  }
}

/** Minimal shape check before trusting a stored snapshot for rendering. */
function isValidAcceptedSnapshot(value: unknown): value is OfferDocumentData {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Partial<OfferDocumentData>
  return typeof snapshot.title === "string" && Array.isArray(snapshot.lineItems)
}

const PUBLIC_OFFER_BASE_SELECT =
  "id, company_id, customer_id, public_slug, title, description, source_summary, status, amount_nok, quote_valid_until, created_at, sent_at, recipient_name, recipient_email, line_items, analysis_result"

export async function fetchPublicOfferBySlug(slug: string) {
  const admin = createAdminClient()

  // Full company profile (logo, contact, address) + contract/payment fields so
  // the customer-facing document carries the sender's branding and terms.
  const { data, error } = await admin
    .from("offers")
    .select(
      PUBLIC_OFFER_BASE_SELECT +
        ", pricing_model, contract_basis, payment_schedule, accepted_at, accepted_by_name, accepted_email, accepted_method, accepted_document_sha256, accepted_snapshot, customers(name, email, phone, address, postal_code, city, org_number), projects(name), companies(" +
        COMPANY_PROFILE_SELECT +
        ")"
    )
    .eq("public_slug", slug)
    .maybeSingle()

  if (!error && data) {
    return mapPublicOfferRow(data as unknown as RawOfferRow)
  }

  // Fallback for databases where the profile (db/16) or contract (db/23)
  // migrations have not been applied yet.
  const { data: basicData, error: basicError } = await admin
    .from("offers")
    .select(
      PUBLIC_OFFER_BASE_SELECT +
        ", customers(name, email, phone, address, city, org_number), projects(name), companies(" +
        COMPANY_BASIC_SELECT +
        ")"
    )
    .eq("public_slug", slug)
    .maybeSingle()

  if (basicError || !basicData) {
    return null
  }

  return mapPublicOfferRow(basicData as unknown as RawOfferRow)
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
