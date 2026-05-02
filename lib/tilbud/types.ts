export type OfferAssignmentMode = "project" | "customer"

export type OfferStatus = "draft" | "sent" | "accepted" | "rejected"

export type OfferSourceDocument = {
  id: string
  name: string
  sizeBytes: number
  type?: string
}

export type OfferLineItem = {
  id: string
  subproject: string
  title: string
  description: string
  quantity: number
  unit: string
  supplier: string
  supplierSku?: string
  supplierUrl?: string
  unitPriceNok: number
  markupPercent: number
  discountPercent: number
}

export type OfferAnalysisResult = {
  summary: string
  warnings: string[]
  reasoning?: string
  generatedAt: string
  model: string
  supplierSnapshots: Array<{
    supplier: string
    product: string
    unit: string
    unitPriceNok: number
    sourceUrl?: string
    fetchedAt: string
  }>
}

export type OfferTotals = {
  subtotalNok: number
  discountNok: number
  totalNok: number
}

export type OfferProjectOption = {
  id: string
  name: string
  customerId: string | null
  customerName: string | null
  customerEmail: string | null
  customerPhone: string | null
}

export type OfferCustomerOption = {
  id: string
  name: string
  email: string | null
  phone: string | null
  city: string | null
}

export type SaveOfferPayload = {
  id?: string
  title: string
  description: string
  assignmentMode: OfferAssignmentMode
  projectId: string | null
  customerId: string
  sourceSummary: string
  sourceDocuments: OfferSourceDocument[]
  lineItems: OfferLineItem[]
  analysisResult: OfferAnalysisResult | null
  sendDirectlyToCustomer: boolean
  recipientName: string
  recipientEmail: string
  recipientPhone: string
  validityDays: number
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function calculateLineItemTotal(item: OfferLineItem) {
  const quantity = Number.isFinite(item.quantity) ? item.quantity : 0
  const baseUnitPrice = Number.isFinite(item.unitPriceNok) ? item.unitPriceNok : 0
  const markupPercent = Number.isFinite(item.markupPercent) ? item.markupPercent : 0
  const discountPercent = Number.isFinite(item.discountPercent) ? item.discountPercent : 0

  const withMarkup = baseUnitPrice * (1 + markupPercent / 100)
  const withDiscount = withMarkup * (1 - discountPercent / 100)
  return roundCurrency(quantity * withDiscount)
}

export function calculateOfferTotals(items: OfferLineItem[]): OfferTotals {
  const subtotalNok = roundCurrency(items.reduce((sum, item) => sum + calculateLineItemTotal(item), 0))
  const rawDiscountNok = roundCurrency(
    items.reduce((sum, item) => {
      const quantity = Number.isFinite(item.quantity) ? item.quantity : 0
      const baseUnitPrice = Number.isFinite(item.unitPriceNok) ? item.unitPriceNok : 0
      const markupPercent = Number.isFinite(item.markupPercent) ? item.markupPercent : 0
      const discountPercent = Number.isFinite(item.discountPercent) ? item.discountPercent : 0

      const withMarkup = baseUnitPrice * (1 + markupPercent / 100)
      const withoutDiscount = quantity * withMarkup
      const withDiscount = withoutDiscount * (1 - discountPercent / 100)
      return sum + (withoutDiscount - withDiscount)
    }, 0)
  )

  return {
    subtotalNok,
    discountNok: rawDiscountNok,
    totalNok: roundCurrency(subtotalNok),
  }
}

export function formatNok(value: number) {
  return new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0)
}
