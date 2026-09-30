import { describe, expect, it } from "vitest"

import {
  isProjectCostAccount,
  mapFikenPurchasesToCosts,
  mapTripletexPostingsToCosts,
  parseAccountNumber,
  resolveMaterialCostSource,
} from "@/lib/regnskap/costs"

describe("kontoregelen", () => {
  it("teller varekost og driftskostnader, aldri lønn eller finans", () => {
    expect(isProjectCostAccount(4300)).toBe(true)
    expect(isProjectCostAccount(4500)).toBe(true)
    expect(isProjectCostAccount(6540)).toBe(true)
    expect(isProjectCostAccount(5000)).toBe(false)
    expect(isProjectCostAccount(5990)).toBe(false)
    expect(isProjectCostAccount(3000)).toBe(false)
    expect(isProjectCostAccount(8150)).toBe(false)
    expect(isProjectCostAccount(null)).toBe(false)
  })

  it("leser kontonummer fra ulike formater", () => {
    expect(parseAccountNumber("4300")).toBe(4300)
    expect(parseAccountNumber("1920:10001")).toBe(1920)
    expect(parseAccountNumber(6540)).toBe(6540)
    expect(parseAccountNumber("Innkjøp")).toBeNull()
  })
})

describe("mapTripletexPostingsToCosts", () => {
  const posting = (over: Record<string, unknown> = {}) => ({
    id: 1,
    date: "2026-09-10",
    description: "Fliser",
    amount: 12500,
    account: { number: 4300, name: "Innkjøp varer" },
    supplier: { name: "Byggmakker" },
    voucher: { id: 900, number: 17, year: 2026 },
    ...over,
  })

  it("mapper kostnadsposteringer og beholder kreditnotaer", () => {
    const rows = mapTripletexPostingsToCosts(
      [posting(), posting({ id: 2, amount: -500 })],
      { projectId: "p1" }
    )
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({
      projectId: "p1",
      externalId: "1",
      accountNumber: "4300",
      supplierName: "Byggmakker",
      voucherRef: "17-2026",
      amountNok: 12500,
    })
    expect(rows[1].amountNok).toBe(-500)
  })

  it("holder lønn og kjørebokas egne reiseregninger utenfor", () => {
    const rows = mapTripletexPostingsToCosts(
      [
        posting({ id: 1, account: { number: 5000 } }),
        posting({ id: 2, account: { number: 7100 }, voucher: { id: 42 } }),
        posting({ id: 3, account: { number: 7140 }, voucher: { id: 43 } }),
      ],
      { projectId: "p1", excludedVoucherIds: new Set([42]) }
    )
    expect(rows.map((r) => r.externalId)).toEqual(["3"])
  })
})

describe("mapFikenPurchasesToCosts", () => {
  const projects = new Map([[11, "p1"], [12, "p2"]])

  it("fører linjer på prosjektet de er merket med, i kroner", () => {
    const rows = mapFikenPurchasesToCosts(
      [
        {
          purchaseId: 5,
          identifier: "F-100",
          date: "2026-09-01",
          supplier: { name: "Optimera" },
          lines: [
            { lineId: 1, description: "Gips", netPrice: 250000, account: "4300", projectId: 11 },
            { lineId: 2, description: "Skruer", netPrice: 10000, account: "4300", projectId: 12 },
            { lineId: 3, description: "Kontor", netPrice: 5000, account: "6800" },
            { lineId: 4, description: "Ukjent prosjekt", netPrice: 5000, account: "4300", projectId: 99 },
          ],
        },
      ],
      projects
    )
    expect(rows.map((r) => [r.projectId, r.externalId, r.amountNok])).toEqual([
      ["p1", "5:1", 2500],
      ["p2", "5:2", 100],
    ])
    expect(rows[0].voucherRef).toBe("F-100")
  })

  it("bruker kjøpets prosjekt når linjen mangler det, og hopper over slettede", () => {
    const rows = mapFikenPurchasesToCosts(
      [
        { purchaseId: 6, project: [{ projectId: 11 }], lines: [{ lineId: 1, netPrice: 1000, account: "4500" }] },
        { purchaseId: 7, deleted: true, lines: [{ lineId: 1, netPrice: 1000, account: "4300", projectId: 11 }] },
      ],
      projects
    )
    expect(rows.map((r) => r.externalId)).toEqual(["6:1"])
  })
})

describe("resolveMaterialCostSource", () => {
  it("bruker de manuelle postene når regnskapet ikke har noe", () => {
    expect(resolveMaterialCostSource({ manualNok: 4000, accountingRows: [] })).toEqual({
      materialCostNok: 4000,
      source: "manuell",
      manualExcludedNok: 0,
    })
  })

  it("lar regnskapet vinne og holder manuelle poster utenfor", () => {
    expect(
      resolveMaterialCostSource({ manualNok: 4000, accountingRows: [{ amount_nok: "12500" }, { amount_nok: -500 }] })
    ).toEqual({ materialCostNok: 12000, source: "regnskap", manualExcludedNok: 4000 })
  })
})
