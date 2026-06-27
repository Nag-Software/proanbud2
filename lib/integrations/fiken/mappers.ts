import { calculateLineItemUnitPriceWithMarkupBeforeDiscount, type OfferLineItem } from "@/lib/tilbud/types"
import type {
  FikenContactPayload,
  FikenDraftLinePayload,
  FikenProjectPayload,
  FikenVatType,
} from "@/lib/integrations/fiken/types"

export type FikenCustomerSource = {
  name: string
  email: string | null
  phone: string | null
  org_number: string | null
  address: string | null
  postal_code: string | null
  city: string | null
}

export function mapCustomerToFiken(customer: FikenCustomerSource): FikenContactPayload {
  const payload: FikenContactPayload = {
    name: customer.name,
    customer: true,
    email: customer.email || undefined,
    organizationNumber: customer.org_number || undefined,
    phoneNumber: customer.phone || undefined,
  }

  // Fiken requires ALL of streetAddress/city/postCode/country when an address is sent.
  // Only include the address object if we have enough to satisfy that.
  if (customer.address && customer.postal_code && customer.city) {
    payload.address = {
      streetAddress: customer.address,
      postCode: customer.postal_code,
      city: customer.city,
      country: "Norway",
    }
  }

  return payload
}

function dateOnly(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : s
}

export function resolveFikenProjectStartDate(project: {
  start_date?: string | null
  created_at?: string | null
}): string {
  return dateOnly(project.start_date) || dateOnly(project.created_at) || new Date().toISOString().slice(0, 10)
}

export function mapProjectToFiken(
  project: {
    name: string
    status: string | null
    description: string | null
    start_date?: string | null
    end_date?: string | null
    created_at?: string | null
  },
  options: { number: string; contactId?: number; startDate: string }
): FikenProjectPayload {
  return {
    name: project.name,
    number: options.number,
    startDate: options.startDate,
    endDate: dateOnly(project.end_date),
    contactId: options.contactId,
    description: project.description || undefined,
    completed: project.status === "completed",
  }
}

// --- Lines ------------------------------------------------------------------
function normalizeOfferLineItems(input: unknown): OfferLineItem[] {
  if (!Array.isArray(input)) {
    return []
  }

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
      } satisfies OfferLineItem
    })
    .filter((item) => item.title.trim().length > 0 && item.quantity > 0)
}

/**
 * Convert an ex-VAT unit price (NOK) to Fiken's øre integer.
 *
 * Verified against the live Fiken OpenAPI spec (invoiceishDraftLine.unitPrice):
 * "Net price per unit in invoice currency (in cents)". So unitPrice is the NET
 * (ex-VAT) price in øre — Fiken derives VAT from vatType. The discount is sent
 * separately as a percentage so it is never applied twice (markup-before-discount).
 */
export function toFikenNetUnitPriceOre(exVatNok: number): number {
  return Math.round(exVatNok * 100)
}

function lineDescription(item: OfferLineItem): string {
  const parts = [item.title.trim()]
  if (item.description.trim()) {
    parts.push(item.description.trim())
  }
  if (item.subproject && item.subproject !== "Generelt") {
    parts.unshift(`[${item.subproject}]`)
  }
  return parts.join(" – ")
}

export function buildFikenDraftLines(
  offer: {
    id: string
    title: string | null
    description: string | null
    amount_nok: number | null
    line_items?: unknown
  },
  options: { vatType: FikenVatType; incomeAccount?: string | null }
): FikenDraftLinePayload[] {
  const items = normalizeOfferLineItems(offer.line_items)
  const incomeAccount = options.incomeAccount || undefined

  if (items.length > 0) {
    return items.map((item) => {
      const exVatUnit = calculateLineItemUnitPriceWithMarkupBeforeDiscount(item)
      const line: FikenDraftLinePayload = {
        description: lineDescription(item),
        unitPrice: toFikenNetUnitPriceOre(exVatUnit),
        quantity: item.quantity,
        vatType: options.vatType,
      }
      if (item.discountPercent > 0) {
        line.discount = item.discountPercent
      }
      if (incomeAccount) {
        line.incomeAccount = incomeAccount
      }
      return line
    })
  }

  // Fallback: a single summary line from the offer total.
  const line: FikenDraftLinePayload = {
    description: offer.title || offer.description || `Tilbud ${offer.id.slice(0, 8)}`,
    unitPrice: toFikenNetUnitPriceOre(Number(offer.amount_nok || 0)),
    quantity: 1,
    vatType: options.vatType,
  }
  if (incomeAccount) {
    line.incomeAccount = incomeAccount
  }
  return [line]
}

/**
 * Body for POST /offers/drafts (invoiceishDraftRequest).
 * Spec requires `type`, `customerId` and `daysUntilDueDate` even for offers.
 */
export function mapOfferDraftFromOffer(
  offer: {
    id: string
    title: string | null
    description: string | null
    amount_nok: number | null
    line_items?: unknown
  },
  customerId: number,
  options: { projectId?: number | null; vatType: FikenVatType; incomeAccount?: string | null; daysUntilDueDate?: number }
): Record<string, unknown> {
  return {
    type: "offer",
    customerId,
    daysUntilDueDate: options.daysUntilDueDate ?? 14,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    lines: buildFikenDraftLines(offer, options),
  }
}

/** Body for POST /invoices/drafts (invoiceishDraftRequest). */
export function mapInvoiceDraftFromOffer(
  offer: {
    id: string
    title: string | null
    description: string | null
    amount_nok: number | null
    line_items?: unknown
  },
  customerId: number,
  options: {
    projectId?: number | null
    vatType: FikenVatType
    incomeAccount?: string | null
    bankAccountCode?: string | null
    daysUntilDueDate?: number
  }
): Record<string, unknown> {
  const issueDate = new Date().toISOString().slice(0, 10)
  return {
    type: "invoice",
    customerId,
    issueDate,
    daysUntilDueDate: options.daysUntilDueDate ?? 14,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    ...(options.bankAccountCode ? { bankAccountCode: options.bankAccountCode } : {}),
    cash: false,
    lines: buildFikenDraftLines(offer, options),
  }
}
