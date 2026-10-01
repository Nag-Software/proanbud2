import { describe, expect, it } from "vitest"

import {
  buildFikenPurchaseDraft,
  buildTripletexCostVoucher,
  costDraftText,
  proanbudCostMarker,
  type ManualCostForPush,
} from "@/lib/regnskap/cost-push"
import { mapFikenSalesToRevenues, mapTripletexPostingsToRevenues } from "@/lib/regnskap/costs"

const cost: ManualCostForPush = {
  id: "1a2b3c4d-0000-0000-0000-000000000000",
  supplierName: "Optimera",
  description: "Fliser og lim",
  amountNok: 1000,
  invoiceRef: "88412",
  costDate: "2026-09-12",
  projectName: "Bad Hansen",
}

describe("kladd til regnskapet", () => {
  it("merker teksten så vi finner igjen vår egen kladd, og holder den under grensen", () => {
    expect(costDraftText(cost)).toBe("Optimera – Fliser og lim · Bad Hansen (ProAnbud #1a2b3c4d)")
    const long = costDraftText({ ...cost, description: "x".repeat(400) })
    expect(long.length).toBeLessThanOrEqual(200)
    expect(long).toContain(proanbudCostMarker(cost.id))
  })

  it("Fiken: kjøpskladd i øre, eks. mva + 25 %, på prosjektet, aldri betalt", () => {
    const draft = buildFikenPurchaseDraft(cost, { fikenProjectId: 77, vatRegistered: true, today: "2026-10-01" })
    expect(draft).toMatchObject({ cash: false, paid: false, projectId: 77, invoiceNumber: "88412", invoiceIssueDate: "2026-09-12" })
    expect((draft.lines as Array<Record<string, unknown>>)[0]).toMatchObject({
      net: 100000,
      gross: 125000,
      vatType: "HIGH",
      incomeAccount: "4300",
      projectId: 77,
    })
  })

  it("Fiken: uten mva-registrering er brutto lik netto", () => {
    const draft = buildFikenPurchaseDraft(cost, { fikenProjectId: null, vatRegistered: false, today: "2026-10-01" })
    expect((draft.lines as Array<Record<string, unknown>>)[0]).toMatchObject({ net: 100000, gross: 100000, vatType: "NONE" })
    expect(draft).not.toHaveProperty("projectId")
  })

  it("Tripletex: bilaget går i null — debet kostnad med prosjekt, kredit leverandørgjeld", () => {
    const voucher = buildTripletexCostVoucher(cost, {
      costAccountId: 1,
      supplierDebtAccountId: 2,
      vatTypeId: 3,
      projectExternalId: 4,
      supplierId: 5,
      vatRegistered: true,
      today: "2026-10-01",
    })
    const postings = voucher.postings as Array<Record<string, unknown>>
    expect(postings.reduce((sum, p) => sum + Number(p.amountGross), 0)).toBe(0)
    expect(postings[0]).toMatchObject({ amountGross: 1250, account: { id: 1 }, vatType: { id: 3 }, project: { id: 4 } })
    expect(postings[1]).toMatchObject({ amountGross: -1250, account: { id: 2 }, supplier: { id: 5 } })
    expect(voucher.externalVoucherNumber).toBe("ProAnbud-#1a2b3c4d")
  })
})

describe("inntekter fra regnskapet", () => {
  it("Tripletex: snur fortegnet på salgsinntekt og tar bare 3000–3999", () => {
    const rows = mapTripletexPostingsToRevenues(
      [
        { id: 1, date: "2026-09-30", amount: -50000, account: { number: 3000, name: "Salg" }, invoiceNumber: 10045 },
        { id: 2, date: "2026-09-30", amount: 5000, account: { number: 3000 } },
        { id: 3, date: "2026-09-30", amount: -12500, account: { number: 2700 } },
      ],
      { projectId: "p1" }
    )
    expect(rows.map((r) => [r.externalId, r.amountNok, r.voucherRef])).toEqual([
      ["1", 50000, "10045"],
      ["2", -5000, null],
    ])
  })

  it("Fiken: salgslinjer på koblede prosjekter, i kroner", () => {
    const rows = mapFikenSalesToRevenues(
      [
        {
          saleId: 9,
          saleNumber: "10045",
          date: "2026-09-30",
          customer: { name: "Hansen" },
          project: { projectId: 77 },
          lines: [
            { lineId: 1, netPrice: 5000000, account: "3000" },
            { lineId: 2, netPrice: 10000, account: "2700" },
          ],
        },
        { saleId: 10, deleted: true, lines: [{ lineId: 1, netPrice: 100, account: "3000", projectId: 77 }] },
      ],
      new Map([[77, "p1"]])
    )
    expect(rows).toEqual([
      expect.objectContaining({ projectId: "p1", externalId: "9:1", amountNok: 50000, voucherRef: "10045", customerName: "Hansen" }),
    ])
  })
})
