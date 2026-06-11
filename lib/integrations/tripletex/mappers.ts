import {
  buildTripletexOfferExternalAccountsNumber,
  buildTripletexOfferNumber,
} from "@/lib/integrations/tripletex/offer-identity"
import { calculateLineItemTotal, type OfferLineItem } from "@/lib/tilbud/types"

export function mapCustomerToTripletex(customer: {
  name: string
  email: string | null
  phone: string | null
  org_number: string | null
  address: string | null
  postal_code: string | null
  city: string | null
}) {
  return {
    name: customer.name,
    email: customer.email || undefined,
    phoneNumber: customer.phone || undefined,
    organizationNumber: customer.org_number || undefined,
    postalAddress: {
      addressLine1: customer.address || undefined,
      postalCode: customer.postal_code || undefined,
      city: customer.city || undefined,
    },
  }
}

function dateOnlyFromDb(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined
  }
  const s = String(value)
  return s.length >= 10 ? s.slice(0, 10) : s
}

/**
 * Maps a local project to Tripletex /project payload.
 * - Tripletex requires startDate.
 * - POST /project rejects new projects with isClosed true ("Nye prosjekter kan ikke ha status avsluttet").
 * - When isClosed is true on update, endDate is required.
 */
export function mapProjectToTripletex(
  project: {
    name: string
    status: string | null
    description: string | null
    start_date?: string | null
    end_date?: string | null
    created_at?: string | null
  },
  options: {
    customerExternalId?: number
    projectManagerExternalId: number
    /** YYYY-MM-DD */
    startDate: string
    /** YYYY-MM-DD when closing in Tripletex */
    endDate?: string | null
    /**
     * true for POST /project — force open in Tripletex even if local status is completed.
     */
    treatAsNewInTripletex: boolean
    isOffer?: boolean
  }
) {
  const startDate = options.startDate
  const completed = project.status === "completed"
  const isClosed = options.treatAsNewInTripletex ? false : completed

  const fromDbStart = dateOnlyFromDb(project.start_date ?? undefined)
  const fromDbEnd = dateOnlyFromDb(project.end_date ?? undefined)

  const resolvedEndDate =
    isClosed && !options.treatAsNewInTripletex
      ? fromDbEnd || options.endDate || startDate
      : undefined

  const payload: {
    name: string
    customer?: { id: number }
    projectManager: { id: number }
    startDate: string
    endDate?: string
    isClosed: boolean
    isOffer: boolean
    description?: string
  } = {
    name: project.name,
    customer: options.customerExternalId ? { id: options.customerExternalId } : undefined,
    projectManager: { id: options.projectManagerExternalId },
    startDate: fromDbStart || startDate,
    isClosed,
    isOffer: options.isOffer ?? false,
    description: project.description || undefined,
  }

  if (resolvedEndDate) {
    payload.endDate = resolvedEndDate
  }

  return payload
}

/** Resolve YYYY-MM-DD for Tripletex startDate from project row. */
export function resolveProjectStartDateForTripletex(project: {
  start_date?: string | null
  created_at?: string | null
}): string {
  const fromStart = dateOnlyFromDb(project.start_date ?? undefined)
  if (fromStart) {
    return fromStart
  }
  const fromCreated = dateOnlyFromDb(project.created_at ?? undefined)
  if (fromCreated) {
    return fromCreated
  }
  return new Date().toISOString().slice(0, 10)
}

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

function lineUnitPriceExVat(item: OfferLineItem) {
  const quantity = item.quantity > 0 ? item.quantity : 1
  const lineTotal = calculateLineItemTotal(item)
  return Math.round((lineTotal / quantity + Number.EPSILON) * 100) / 100
}

function buildOrderLine(item: OfferLineItem, options?: { defaultVatTypeId?: number | null; defaultAccountId?: number | null }) {
  const descriptionParts = [item.title.trim()]
  if (item.description.trim()) {
    descriptionParts.push(item.description.trim())
  }
  if (item.subproject && item.subproject !== "Generelt") {
    descriptionParts.unshift(`[${item.subproject}]`)
  }

  const line: Record<string, unknown> = {
    description: descriptionParts.join(" – "),
    count: item.quantity,
    unitPriceExcludingVatCurrency: lineUnitPriceExVat(item),
  }

  if (item.discountPercent > 0) {
    line.discount = item.discountPercent
  }

  if (options?.defaultVatTypeId) {
    line.vatType = { id: options.defaultVatTypeId }
  }

  if (options?.defaultAccountId) {
    line.account = { id: options.defaultAccountId }
  }

  return line
}

/**
 * POST/PUT /order — Tripletex binds nested refs (`customer`, `project`) and order lines use `count`.
 */
export function mapOrderFromOffer(
  offer: {
    id: string
    title: string | null
    description: string | null
    amount_nok: number | null
    line_items?: unknown
  },
  customerExternalId: number,
  projectExternalId?: number | null,
  options?: {
    defaultVatTypeId?: number | null
    defaultAccountId?: number | null
  }
) {
  const lineItems = normalizeOfferLineItems(offer.line_items)
  const orderDate = new Date().toISOString().slice(0, 10)

  const orderLines =
    lineItems.length > 0
      ? lineItems.map((item) => buildOrderLine(item, options))
      : [
          {
            description: offer.title || offer.description || `Tilbud ${offer.id}`,
            count: 1,
            unitPriceExcludingVatCurrency: Number(offer.amount_nok || 0),
            ...(options?.defaultVatTypeId ? { vatType: { id: options.defaultVatTypeId } } : {}),
            ...(options?.defaultAccountId ? { account: { id: options.defaultAccountId } } : {}),
          },
        ]

  return {
    customer: { id: customerExternalId },
    ...(projectExternalId ? { project: { id: projectExternalId } } : {}),
    orderDate,
    deliveryDate: orderDate,
    isPrioritizeAmountsIncludingVat: false,
    orderLines,
  }
}

/**
 * POST/PUT /project with isOffer=true — appears in Tripletex Tilbudsoversikt.
 */
export function mapProjectOfferFromOffer(
  offer: {
    id: string
    title: string | null
    description: string | null
    amount_nok: number | null
    pricing_model?: string | null
  },
  customerExternalId: number,
  projectManagerExternalId: number,
  options?: { startDate?: string; projectName?: string | null }
) {
  const startDate = options?.startDate || new Date().toISOString().slice(0, 10)
  const pricingModel = offer.pricing_model || "fixed"
  const isFixedPrice = pricingModel === "fixed" || pricingModel === "unit_price" || pricingModel === "mixed"

  return {
    name: offer.title?.trim() || options?.projectName?.trim() || `Tilbud ${offer.id.slice(0, 8)}`,
    number: buildTripletexOfferNumber(offer.id),
    externalAccountsNumber: buildTripletexOfferExternalAccountsNumber(offer.id),
    customer: { id: customerExternalId },
    projectManager: { id: projectManagerExternalId },
    startDate,
    isOffer: true,
    isClosed: false,
    isFixedPrice,
    fixedprice: isFixedPrice && offer.amount_nok ? Number(offer.amount_nok) : undefined,
    description: offer.description?.trim() || undefined,
  }
}

/** Maps ProAnbud line_items to Tripletex /project/orderline rows on a tilbud (isOffer=true). */
export function mapTilbudOrderLinesFromOffer(
  offer: {
    id: string
    title: string | null
    description: string | null
    amount_nok: number | null
    line_items?: unknown
  },
  tilbudExternalId: number,
  options?: { defaultVatTypeId?: number | null }
) {
  const lineItems = normalizeOfferLineItems(offer.line_items)
  const lines =
    lineItems.length > 0
      ? lineItems.map((item) => {
          const descriptionParts = [item.title.trim()]
          if (item.description.trim()) descriptionParts.push(item.description.trim())
          if (item.subproject && item.subproject !== "Generelt") {
            descriptionParts.unshift(`[${item.subproject}]`)
          }

          const line: Record<string, unknown> = {
            project: { id: tilbudExternalId },
            description: descriptionParts.join(" – "),
            count: item.quantity,
            unitPriceExcludingVatCurrency: lineUnitPriceExVat(item),
          }

          if (item.discountPercent > 0) {
            line.discount = item.discountPercent
          }
          if (options?.defaultVatTypeId) {
            line.vatType = { id: options.defaultVatTypeId }
          }
          return line
        })
      : [
          {
            project: { id: tilbudExternalId },
            description: offer.title || offer.description || `Tilbud ${offer.id}`,
            count: 1,
            unitPriceExcludingVatCurrency: Number(offer.amount_nok || 0),
            ...(options?.defaultVatTypeId ? { vatType: { id: options.defaultVatTypeId } } : {}),
          },
        ]

  return lines
}

/** @deprecated Use mapTilbudOrderLinesFromOffer */
export const mapProjectOrderLinesFromOffer = mapTilbudOrderLinesFromOffer
