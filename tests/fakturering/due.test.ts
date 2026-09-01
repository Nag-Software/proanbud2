import { describe, expect, it } from "vitest"

import { computeInvoiceDueState, describeInvoiceDue } from "../../lib/fakturering/due"

const NOW = new Date("2026-09-20T12:00:00Z").getTime()
const DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString()

function invoice(overrides: Partial<Parameters<typeof computeInvoiceDueState>[0]> = {}) {
  return { status: "sent", sentAt: daysAgo(20), dueDays: 14, paidAt: null, ...overrides }
}

describe("computeInvoiceDueState", () => {
  it("regner ut dager over fristen", () => {
    // Sendt for 20 dager siden, 14 dagers frist → 6 dager over.
    const state = computeInvoiceDueState(invoice(), NOW)
    expect(state.daysOverdue).toBe(6)
    expect(state.isOverdue).toBe(true)
  })

  it("er IKKE forfalt på selve forfallsdagen", () => {
    const state = computeInvoiceDueState(invoice({ sentAt: daysAgo(14) }), NOW)
    expect(state.daysOverdue).toBe(0)
    expect(state.isOverdue).toBe(false)
  })

  it("teller ned før forfall", () => {
    const state = computeInvoiceDueState(invoice({ sentAt: daysAgo(10) }), NOW)
    expect(state.daysOverdue).toBe(-4)
    expect(state.isOverdue).toBe(false)
  })

  it("en BETALT faktura kan aldri forfalle", () => {
    expect(computeInvoiceDueState(invoice({ paidAt: daysAgo(1) }), NOW).isOverdue).toBe(false)
    expect(computeInvoiceDueState(invoice({ status: "paid" }), NOW).isOverdue).toBe(false)
  })

  it("en KANSELLERT faktura kan aldri forfalle", () => {
    expect(computeInvoiceDueState(invoice({ status: "cancelled" }), NOW).isOverdue).toBe(false)
  })

  it("en USENDT faktura har ingen frist å bryte", () => {
    const state = computeInvoiceDueState(invoice({ status: "draft", sentAt: null }), NOW)
    expect(state.daysOverdue).toBeNull()
    expect(state.isOverdue).toBe(false)
  })

  it("faller tilbake til 14 dager når fristen mangler", () => {
    expect(computeInvoiceDueState(invoice({ dueDays: null }), NOW).daysOverdue).toBe(6)
  })

  it("respekterer en avvikende betalingsfrist", () => {
    // 30 dagers frist på en 20 dager gammel faktura → 10 dager igjen.
    expect(computeInvoiceDueState(invoice({ dueDays: 30 }), NOW).daysOverdue).toBe(-10)
  })
})

describe("describeInvoiceDue", () => {
  it("formulerer forfall, i dag og gjenstående tid på norsk", () => {
    expect(describeInvoiceDue(computeInvoiceDueState(invoice(), NOW))).toBe("forfalt for 6 dager siden")
    expect(describeInvoiceDue(computeInvoiceDueState(invoice({ sentAt: daysAgo(15) }), NOW))).toBe(
      "forfalt for 1 dag siden"
    )
    expect(describeInvoiceDue(computeInvoiceDueState(invoice({ sentAt: daysAgo(14) }), NOW))).toBe(
      "forfaller i dag"
    )
    expect(describeInvoiceDue(computeInvoiceDueState(invoice({ sentAt: daysAgo(13) }), NOW))).toBe(
      "forfaller om 1 dag"
    )
    expect(describeInvoiceDue(computeInvoiceDueState(invoice({ sentAt: daysAgo(10) }), NOW))).toBe(
      "forfaller om 4 dager"
    )
  })

  it("sier ingenting om en faktura uten frist", () => {
    expect(describeInvoiceDue(computeInvoiceDueState(invoice({ sentAt: null }), NOW))).toBeNull()
  })
})

// Lista viser «Forfalt» fra dag 1; dashbordet venter 3 dager. Samme tall, ulik terskel.
describe("lista og dashbordet bruker samme beregning", () => {
  it("dag 1 over fristen: lista viser forfalt, dashbordet maser ikke ennå", async () => {
    const { selectOverdueInvoices } = await import("../../lib/dashboard/waiting-signals")
    const sentAt = daysAgo(15)
    expect(computeInvoiceDueState(invoice({ sentAt }), NOW).isOverdue).toBe(true)
    expect(
      selectOverdueInvoices(
        [
          {
            id: "i1",
            status: "sent",
            amountNok: 1000,
            dueDays: 14,
            sentAt,
            createdAt: sentAt,
            projectId: "p1",
            projectName: "P",
            customerName: "K",
          },
        ],
        NOW
      )
    ).toHaveLength(0)
  })
})
