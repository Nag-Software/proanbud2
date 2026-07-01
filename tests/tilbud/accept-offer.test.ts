import { describe, expect, it } from "vitest"

import {
  buildAcceptanceSnapshot,
  generateAcceptCode,
  hashAcceptCode,
  hashAcceptanceSnapshot,
  maskEmail,
} from "@/lib/tilbud/accept-offer.shared"
import { type PublicOfferRecord } from "@/lib/tilbud/public-offer"

function makeRecord(): PublicOfferRecord {
  return {
    id: "offer-1",
    companyId: "company-1",
    customerId: "customer-1",
    publicSlug: "slug-1",
    title: "Testtilbud",
    description: "Beskrivelse",
    projectSummary: "Oppsummering",
    sourceSummary: "Melding",
    status: "sent",
    amountNok: 1000,
    quoteValidUntil: "2026-07-31",
    createdAt: "2026-07-01T09:00:00Z",
    sentAt: "2026-07-01T10:00:00Z",
    recipientName: "Kari",
    recipientEmail: "kari@example.com",
    lineItems: [
      {
        id: "l1",
        subproject: "Generelt",
        title: "Linje",
        description: "",
        quantity: 1,
        unit: "stk",
        supplier: "",
        unitPriceNok: 100,
        markupPercent: 0,
        discountPercent: 0,
      },
    ],
    company: { id: "company-1", name: "Firma AS", orgNumber: "999 999 999" },
    projectName: "Prosjekt",
    customer: {
      name: "Kari Nordmann",
      email: "kari@example.com",
      phone: null,
      address: null,
      postalCode: null,
      city: null,
      orgNumber: null,
    },
    validityDays: 30,
    offerReference: "OFFER1",
    isExpired: false,
    canRespond: true,
    paymentSchedule: [],
    pricingModel: "fixed",
    contractBasis: "none",
    acceptance: null,
    acceptedSnapshot: null,
  }
}

describe("maskEmail", () => {
  it("keeps two characters and the domain", () => {
    expect(maskEmail("kari.nordmann@example.com")).toBe("ka•••••@example.com")
  })

  it("handles short locals and junk", () => {
    expect(maskEmail("a@b.no")).toBe("a•@b.no")
    expect(maskEmail("not-an-email")).toBe("•••")
  })
})

describe("generateAcceptCode", () => {
  it("returns 6 digits", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(generateAcceptCode()).toMatch(/^\d{6}$/)
    }
  })
})

describe("hashAcceptCode", () => {
  it("is deterministic per offer and code, and trims input", () => {
    expect(hashAcceptCode("offer-1", "123456")).toBe(hashAcceptCode("offer-1", " 123456 "))
    expect(hashAcceptCode("offer-1", "123456")).not.toBe(hashAcceptCode("offer-2", "123456"))
    expect(hashAcceptCode("offer-1", "123456")).not.toBe(hashAcceptCode("offer-1", "123457"))
    expect(hashAcceptCode("offer-1", "123456")).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe("buildAcceptanceSnapshot", () => {
  it("produces a deterministic hash for the same record", () => {
    const a = buildAcceptanceSnapshot(makeRecord())
    const b = buildAcceptanceSnapshot(makeRecord())
    expect(hashAcceptanceSnapshot(a)).toBe(hashAcceptanceSnapshot(b))
  })

  it("changes the hash when the content changes", () => {
    const base = buildAcceptanceSnapshot(makeRecord())
    const changed = makeRecord()
    changed.lineItems[0].unitPriceNok = 999
    expect(hashAcceptanceSnapshot(base)).not.toBe(hashAcceptanceSnapshot(buildAcceptanceSnapshot(changed)))
  })

  it("carries the fields the document renderer needs", () => {
    const snapshot = buildAcceptanceSnapshot(makeRecord())
    expect(snapshot.title).toBe("Testtilbud")
    expect(snapshot.offerReference).toBe("OFFER1")
    expect(snapshot.lineItems).toHaveLength(1)
    expect(snapshot.company?.name).toBe("Firma AS")
    expect(snapshot.quoteValidUntil).toBe("2026-07-31")
  })
})
