export type OfferActivityEvent = {
  id: number
  eventType: string
  title: string
  description: string | null
  metadata: Record<string, unknown>
  actorUserId: string | null
  createdAt: string
}

export const OFFER_ACTIVITY = {
  CREATED: "offer.created",
  UPDATED: "offer.updated",
  SENT: "offer.sent",
  VIEWED: "offer.viewed",
  ACCEPTED: "offer.accepted",
  REJECTED: "offer.rejected",
  CUSTOMER_MESSAGE: "offer.customer.message",
  CONTRACT_DRAFT_CREATED: "offer.contract.draft_created",
  CONTRACT_SENT: "offer.contract.sent",
  CONTRACT_COMPLETED: "offer.contract.completed",
  CONTRACT_DECLINED: "offer.contract.declined",
  CONTRACT_VOIDED: "offer.contract.voided",
  ERP_ORDER_SYNCED: "offer.erp.order_synced",
  INVOICE_CREATED: "offer.invoice.created",
  INVOICE_SENT: "offer.invoice.sent",
  INVOICE_PAID: "offer.invoice.paid",
  PDF_EXPORTED: "offer.pdf.exported",
  AI_ANALYSIS: "offer.ai.analysis",
  PROJECT_SUMMARY: "offer.project_summary.generated",
} as const

export function getOfferActivityTone(eventType: string) {
  const value = eventType.toLowerCase()
  if (
    value.includes("completed") ||
    value === OFFER_ACTIVITY.SENT ||
    value === OFFER_ACTIVITY.CREATED ||
    value === OFFER_ACTIVITY.ACCEPTED ||
    value === OFFER_ACTIVITY.CONTRACT_DRAFT_CREATED ||
    value === OFFER_ACTIVITY.ERP_ORDER_SYNCED ||
    value === OFFER_ACTIVITY.INVOICE_PAID
  ) {
    return "theme-activity-success"
  }
  if (value.includes("declined") || value.includes("voided") || value.includes("error") || value === OFFER_ACTIVITY.REJECTED) {
    return "theme-activity-error"
  }
  return "theme-activity-info"
}
