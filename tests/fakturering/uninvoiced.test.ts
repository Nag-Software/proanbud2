import { describe, expect, it } from "vitest"

import { computeUninvoicedProjects, type UninvoicedInput } from "../../lib/fakturering/uninvoiced"

const project = { id: "p1", name: "Baderom Storgata", customerName: "Berg AS", completedAt: "2026-09-01" }

function input(overrides: Partial<UninvoicedInput> = {}): UninvoicedInput {
  return {
    projects: [project],
    offers: [{ id: "o1", projectId: "p1", amountNok: 100000 }],
    changeOrders: [],
    invoicedLines: [],
    ...overrides,
  }
}

describe("computeUninvoicedProjects", () => {
  it("flagger ferdig prosjekt med ufakturert tilbud", () => {
    const rows = computeUninvoicedProjects(input())
    expect(rows).toHaveLength(1)
    expect(rows[0].remainingNok).toBe(100000)
    expect(rows[0].customerName).toBe("Berg AS")
  })

  it("legger tilleggsarbeid oppå tilbudet", () => {
    const rows = computeUninvoicedProjects(
      input({ changeOrders: [{ id: "c1", projectId: "p1", amountNok: 25000 }] })
    )
    expect(rows[0].remainingNok).toBe(125000)
  })

  it("trekker fra det som allerede er fakturert", () => {
    const rows = computeUninvoicedProjects(
      input({ invoicedLines: [{ sourceType: "offer", sourceId: "o1", amountNok: 40000 }] })
    )
    expect(rows[0].remainingNok).toBe(60000)
  })

  it("flagger IKKE prosjekt der alt er fakturert", () => {
    const rows = computeUninvoicedProjects(
      input({ invoicedLines: [{ sourceType: "offer", sourceId: "o1", amountNok: 100000 }] })
    )
    expect(rows).toHaveLength(0)
  })

  it("teller ikke fakturalinjer fra en annen kilde med samme id", () => {
    // Samme id, ulik type — må ikke kvitte ut tilbudet.
    const rows = computeUninvoicedProjects(
      input({ invoicedLines: [{ sourceType: "change_order", sourceId: "o1", amountNok: 100000 }] })
    )
    expect(rows[0].remainingNok).toBe(100000)
  })

  it("lar overfakturering på én post ikke skjule en annen", () => {
    const rows = computeUninvoicedProjects(
      input({
        offers: [
          { id: "o1", projectId: "p1", amountNok: 100000 },
          { id: "o2", projectId: "p1", amountNok: 50000 },
        ],
        // o1 er overfakturert; det skal ikke trekkes fra o2.
        invoicedLines: [{ sourceType: "offer", sourceId: "o1", amountNok: 130000 }],
      })
    )
    expect(rows[0].remainingNok).toBe(50000)
  })

  it("sorterer størst beløp først", () => {
    const rows = computeUninvoicedProjects({
      projects: [project, { id: "p2", name: "Kjøkken", customerName: null, completedAt: null }],
      offers: [
        { id: "o1", projectId: "p1", amountNok: 10000 },
        { id: "o2", projectId: "p2", amountNok: 90000 },
      ],
      changeOrders: [],
      invoicedLines: [],
    })
    expect(rows.map((r) => r.projectId)).toEqual(["p2", "p1"])
  })

  it("ignorerer poster uten prosjekt", () => {
    const rows = computeUninvoicedProjects(input({ offers: [{ id: "o1", projectId: null, amountNok: 100000 }] }))
    expect(rows).toHaveLength(0)
  })
})
