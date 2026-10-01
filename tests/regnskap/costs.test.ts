import { describe, expect, it } from "vitest"

import {
  isProjectCostAccount,
  mapFikenPurchasesToCosts,
  mapTripletexPostingsToCosts,
  matchManualToBooked,
  parseAccountNumber,
  summarizeMaterialCosts,
  type MaterialCostLike,
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

const manual = (id: string, amount: number, date: string | null, extra: Partial<MaterialCostLike> = {}): MaterialCostLike => ({
  id,
  source: "manual",
  amount_nok: amount,
  cost_date: date,
  ...extra,
})
const booked = (id: string, amount: number, date: string | null, voucher: string | null = null): MaterialCostLike => ({
  id,
  source: "tripletex",
  amount_nok: amount,
  cost_date: date,
  voucher_ref: voucher,
})

describe("matchManualToBooked", () => {
  it("kobler en manuell post til bokført kostnad med samme beløp", () => {
    const matches = matchManualToBooked([manual("m1", 6950, "2026-09-17"), booked("b1", 6950, "2026-09-18")])
    expect([...matches]).toEqual([["m1", "b1"]])
  })

  it("godtar beløp tastet inkl. mva og summen av et bilag med flere linjer", () => {
    const matches = matchManualToBooked([
      manual("inkl", 1250, "2026-09-01"),
      booked("b1", 1000, "2026-09-02"),
      manual("faktura", 3000, "2026-09-10"),
      booked("l1", 2000, "2026-09-11", "201-2026"),
      booked("l2", 1000, "2026-09-11", "201-2026"),
    ])
    expect(matches.get("inkl")).toBe("b1")
    expect(matches.get("faktura")).toBe("l1")
  })

  it("kobler ikke når datoene ligger langt fra hverandre eller beløpet avviker", () => {
    expect(matchManualToBooked([manual("m1", 5000, "2026-01-01"), booked("b1", 5000, "2026-06-01")]).size).toBe(0)
    expect(matchManualToBooked([manual("m1", 5000, "2026-09-01"), booked("b1", 5100, "2026-09-01")]).size).toBe(0)
  })

  it("lar hver bokført kostnad erstatte bare én manuell post", () => {
    const matches = matchManualToBooked([
      manual("m1", 900, "2026-09-01"),
      manual("m2", 900, "2026-09-03"),
      booked("b1", 900, "2026-09-02"),
    ])
    expect(matches.size).toBe(1)
  })

  it("rører ikke eksisterende koblinger eller poster markert «ikke samme kjøp»", () => {
    const matches = matchManualToBooked([
      manual("m1", 900, "2026-09-01", { replaced_by: "b1" }),
      manual("m2", 900, "2026-09-01", { keep_separate: true }),
      booked("b1", 900, "2026-09-02"),
      booked("b2", 900, "2026-09-02"),
    ])
    expect(matches.size).toBe(0)
  })
})

describe("summarizeMaterialCosts", () => {
  it("teller bokført pluss manuelle poster som ikke er bokført, aldri samme kjøp to ganger", () => {
    expect(
      summarizeMaterialCosts([
        booked("b1", 12500, null),
        booked("kreditnota", -500, null),
        manual("m1", 4000, null, { replaced_by: "b1" }),
        manual("m2", 1240, null),
      ])
    ).toEqual({ materialCostNok: 13240, bookedNok: 12000, manualNok: 1240, replacedNok: 4000 })
  })
})
