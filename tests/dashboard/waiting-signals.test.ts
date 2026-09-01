import { describe, expect, it } from "vitest"

import {
  CHANGE_ORDER_SILENCE_DAYS,
  OFFER_EXPIRY_WARNING_DAYS,
  OFFER_SILENCE_DAYS,
  OVERDUE_GRACE_DAYS,
  WAITING_PRIORITY,
  isMoneyBlockingJobType,
  selectBlockingSyncFailures,
  selectExpiringOffers,
  selectOverdueInvoices,
  selectUnansweredChangeOrders,
  selectUnsentInvoices,
  selectViewedUnansweredOffers,
  type InvoiceRow,
  type OfferRow,
} from "../../lib/dashboard/waiting-signals"

const NOW = new Date("2026-09-20T12:00:00Z").getTime()
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString()
const inDays = (n: number) => new Date(NOW + n * DAY).toISOString()

function invoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: "i1",
    status: "sent",
    amountNok: 50000,
    dueDays: 14,
    sentAt: daysAgo(20),
    createdAt: daysAgo(20),
    projectId: "p1",
    projectName: "Baderom",
    customerName: "Berg AS",
    ...overrides,
  }
}

function offer(overrides: Partial<OfferRow> = {}): OfferRow {
  return {
    id: "o1",
    title: "Bad",
    amountNok: 100000,
    sentAt: daysAgo(10),
    customerViewedAt: null,
    quoteValidUntil: null,
    customerName: "Berg AS",
    ...overrides,
  }
}

describe("forfalte fakturaer", () => {
  it("varsler når forfall er passert med god margin", () => {
    // Sendt for 20 dager siden, 14 dagers forfall → 6 dager over.
    const rows = selectOverdueInvoices([invoice()], NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0].daysOverdue).toBe(6)
  })

  it("MASER IKKE rett etter forfall — betalinger bruker et par dager", () => {
    // 15 dager siden, 14 dagers forfall → 1 dag over, under nåden.
    expect(selectOverdueInvoices([invoice({ sentAt: daysAgo(15) })], NOW)).toHaveLength(0)
    expect(OVERDUE_GRACE_DAYS).toBe(3)
  })

  it("varsler ikke om fakturaer som ikke er forfalt", () => {
    expect(selectOverdueInvoices([invoice({ sentAt: daysAgo(5) })], NOW)).toHaveLength(0)
  })

  it("ignorerer usendte fakturaer — de er et annet signal", () => {
    expect(selectOverdueInvoices([invoice({ status: "draft", sentAt: null })], NOW)).toHaveLength(0)
  })

  it("sorterer mest forfalt først", () => {
    const rows = selectOverdueInvoices(
      [invoice({ id: "a", sentAt: daysAgo(20) }), invoice({ id: "b", sentAt: daysAgo(60) })],
      NOW
    )
    expect(rows.map((r) => r.id)).toEqual(["b", "a"])
  })
})

describe("usendte fakturaer", () => {
  it("varsler om utkast eldre enn ett døgn", () => {
    expect(selectUnsentInvoices([invoice({ status: "draft", createdAt: daysAgo(2) })], NOW)).toHaveLength(1)
  })

  it("MASER IKKE om en faktura du nettopp opprettet", () => {
    expect(selectUnsentInvoices([invoice({ status: "draft", createdAt: daysAgo(0) })], NOW)).toHaveLength(0)
  })

  it("tar ikke med sendte fakturaer", () => {
    expect(selectUnsentInvoices([invoice({ status: "sent" })], NOW)).toHaveLength(0)
  })
})

describe("feilet synk", () => {
  it("varsler kun om feil som stopper penger", () => {
    expect(isMoneyBlockingJobType("invoice.create_from_project_invoice")).toBe(true)
    expect(isMoneyBlockingJobType("invoice.send")).toBe(true)
    expect(isMoneyBlockingJobType("offer.create_from_offer")).toBe(true)
  })

  it("MASER IKKE om prosjektmodul eller kontaktsynk", () => {
    // project.upsert feiler med 402 når Fikens prosjektmodul ikke er kjøpt. Den slår
    // seg av selv og stopper ikke fakturering — å varsle ville vært ren støy.
    expect(isMoneyBlockingJobType("project.upsert")).toBe(false)
    expect(isMoneyBlockingJobType("contact.upsert")).toBe(false)
    expect(isMoneyBlockingJobType("poll_payments")).toBe(false)
    expect(isMoneyBlockingJobType("reconcile.full")).toBe(false)
  })

  it("filtrerer en blandet liste", () => {
    const rows = selectBlockingSyncFailures([
      { job_type: "project.upsert" },
      { job_type: "invoice.send" },
      { job_type: "contact.upsert" },
    ])
    expect(rows).toEqual([{ job_type: "invoice.send" }])
  })
})

describe("tilbud", () => {
  it("varsler om lest tilbud uten svar", () => {
    const rows = selectViewedUnansweredOffers([offer({ customerViewedAt: daysAgo(5) })], NOW)
    expect(rows).toHaveLength(1)
  })

  it("MASER IKKE dagen etter at kunden åpnet det", () => {
    expect(selectViewedUnansweredOffers([offer({ customerViewedAt: daysAgo(1) })], NOW)).toHaveLength(0)
    expect(OFFER_SILENCE_DAYS).toBe(3)
  })

  it("tar ikke med uåpnede tilbud — det er et eget signal", () => {
    expect(selectViewedUnansweredOffers([offer({ customerViewedAt: null })], NOW)).toHaveLength(0)
  })

  it("varsler om tilbud som går ut om få dager", () => {
    expect(selectExpiringOffers([offer({ quoteValidUntil: inDays(2) })], NOW)).toHaveLength(1)
    expect(OFFER_EXPIRY_WARNING_DAYS).toBe(3)
  })

  it("MASER IKKE om tilbud med lang gyldighet igjen", () => {
    expect(selectExpiringOffers([offer({ quoteValidUntil: inDays(20) })], NOW)).toHaveLength(0)
  })

  it("varsler IKKE om allerede utløpte — handlingsvinduet er ute", () => {
    expect(selectExpiringOffers([offer({ quoteValidUntil: daysAgo(2) })], NOW)).toHaveLength(0)
  })
})

describe("tilleggsarbeid uten svar", () => {
  it("varsler etter fem dagers stillhet", () => {
    const rows = selectUnansweredChangeOrders(
      [{ id: "c1", title: "Ekstra rør", amountNok: 12000, sentAt: daysAgo(6), projectId: "p1" }],
      NOW
    )
    expect(rows).toHaveLength(1)
    expect(CHANGE_ORDER_SILENCE_DAYS).toBe(5)
  })

  it("MASER IKKE de første dagene", () => {
    const rows = selectUnansweredChangeOrders(
      [{ id: "c1", title: "Ekstra rør", amountNok: 12000, sentAt: daysAgo(2), projectId: "p1" }],
      NOW
    )
    expect(rows).toHaveLength(0)
  })
})

describe("prioritering", () => {
  it("rangerer penger over salg over hygiene", () => {
    expect(WAITING_PRIORITY.overdueInvoice).toBeLessThan(WAITING_PRIORITY.unansweredChangeOrder)
    expect(WAITING_PRIORITY.unansweredChangeOrder).toBeLessThan(WAITING_PRIORITY.offerViewedNoAnswer)
    expect(WAITING_PRIORITY.offerViewedNoAnswer).toBeLessThan(WAITING_PRIORITY.hours)
    expect(WAITING_PRIORITY.hours).toBeLessThan(WAITING_PRIORITY.deviations)
  })

  it("setter ufakturert arbeid og feilet synk høyt", () => {
    expect(WAITING_PRIORITY.failedSync).toBeLessThan(WAITING_PRIORITY.uninvoiced)
    expect(WAITING_PRIORITY.uninvoiced).toBeLessThan(WAITING_PRIORITY.offerNotOpened)
  })
})
