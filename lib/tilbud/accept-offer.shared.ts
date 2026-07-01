import { createHash, randomInt } from "node:crypto"

import { type OfferDocumentData } from "@/lib/tilbud/offer-document"
import { type PublicOfferRecord } from "@/lib/tilbud/public-offer"

export const ACCEPT_CODE_TTL_MS = 10 * 60 * 1000
export const ACCEPT_CODE_RESEND_COOLDOWN_MS = 60 * 1000
export const ACCEPT_CODE_MAX_ATTEMPTS = 5

/** "kari.nordmann@example.com" -> "ka•••@example.com" — recognizable without leaking the full address. */
export function maskEmail(email: string) {
  const [local, domain] = email.split("@")
  if (!local || !domain) return "•••"
  const visible = local.slice(0, 2)
  return `${visible}${"•".repeat(Math.max(1, Math.min(5, local.length - visible.length)))}@${domain}`
}

export function generateAcceptCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0")
}

/** The code is never stored in cleartext — only sha256(offerId:code). */
export function hashAcceptCode(offerId: string, code: string) {
  return createHash("sha256").update(`${offerId}:${code.trim()}`).digest("hex")
}

export function hashAcceptanceSnapshot(snapshot: OfferDocumentData) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")
}

/**
 * Freeze the exact document the customer accepts. Key order is fixed by this
 * constructor, so the SHA-256 over JSON.stringify is deterministic and the
 * stored hash can be recomputed from the stored snapshot later.
 */
export function buildAcceptanceSnapshot(record: PublicOfferRecord): OfferDocumentData {
  return {
    title: record.title,
    description: record.description,
    projectSummary: record.projectSummary,
    quoteMessage: record.sourceSummary,
    projectName: record.projectName,
    offerReference: record.offerReference,
    customer: {
      name: record.customer.name,
      email: record.customer.email,
      phone: record.customer.phone,
      address: record.customer.address,
      postalCode: record.customer.postalCode,
      city: record.customer.city,
      orgNumber: record.customer.orgNumber,
    },
    lineItems: record.lineItems,
    company: record.company,
    issuedDate: record.createdAt,
    validityDays: record.validityDays,
    quoteValidUntil: record.quoteValidUntil,
    paymentSchedule: record.paymentSchedule,
    pricingModel: record.pricingModel,
    contractBasis: record.contractBasis,
  }
}
