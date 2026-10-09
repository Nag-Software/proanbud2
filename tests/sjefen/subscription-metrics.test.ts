import { describe, expect, it } from "vitest"

import {
  churnWindow,
  computeKpis,
  isCompedNow,
  isPayingNow,
  markTrialConversionsAcrossSubscriptions,
  monthlyAmountNok,
  monthlyRows,
  mrrAt,
  payingSince,
  trialCohort,
  trialConverted,
  type SubscriptionFacts,
} from "@/lib/sjefen/subscription-metrics"

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse("2026-10-09T12:00:00Z")

function sub(overrides: Partial<SubscriptionFacts> & { id: string }): SubscriptionFacts {
  return {
    customerId: null,
    companyId: null,
    status: "active",
    planKey: "proff",
    interval: "month",
    mrrNok: 690,
    startedAt: NOW - 100 * DAY,
    trialStart: null,
    trialEnd: null,
    endedAt: null,
    canceledAt: null,
    cancelAtPeriodEnd: false,
    firstPaidAt: null,
    ...overrides,
  }
}

describe("monthlyAmountNok", () => {
  const price = (unit: number, interval: "month" | "year") => ({
    unit_amount: unit,
    recurring: { interval, interval_count: 1 },
  })

  it("summerer linjer, deler årspris på 12 og trekker rabatt", () => {
    expect(monthlyAmountNok([{ quantity: 1, price: price(69000, "month") }])).toBe(690)
    expect(monthlyAmountNok([{ quantity: 1, price: price(708000, "year") }])).toBe(590)
    expect(
      monthlyAmountNok([
        { quantity: 1, price: price(69000, "month") },
        { quantity: 3, price: price(6900, "month") },
      ])
    ).toBe(897)
    expect(
      monthlyAmountNok(
        [{ quantity: 1, price: price(69000, "month") }],
        [{ end: null, coupon: { percent_off: 50, amount_off: null } }]
      )
    ).toBe(345)
  })

  it("ser bort fra utløpt rabatt", () => {
    expect(
      monthlyAmountNok(
        [{ quantity: 1, price: price(69000, "month") }],
        [{ end: (NOW - DAY) / 1000, coupon: { percent_off: 80, amount_off: null } }],
        NOW
      )
    ).toBe(690)
  })
})

describe("konvertering og churn", () => {
  const trialConvertedNow = sub({
    id: "a",
    status: "active",
    trialStart: NOW - 40 * DAY,
    trialEnd: NOW - 26 * DAY,
  })
  const trialLapsed = sub({
    id: "b",
    status: "canceled",
    trialStart: NOW - 40 * DAY,
    trialEnd: NOW - 26 * DAY,
    endedAt: NOW - 26 * DAY,
    mrrNok: 299,
  })
  const trialPaidThenChurned = sub({
    id: "c",
    status: "canceled",
    trialStart: NOW - 120 * DAY,
    trialEnd: NOW - 106 * DAY,
    endedAt: NOW - 10 * DAY,
    mrrNok: 299,
  })
  const trialRunning = sub({
    id: "d",
    status: "trialing",
    trialStart: NOW - 5 * DAY,
    trialEnd: NOW + 9 * DAY,
  })
  const direct = sub({ id: "e", status: "past_due", startedAt: NOW - 50 * DAY, mrrNok: 299 })
  const stampedTrial = sub({
    id: "f",
    status: "active",
    trialStart: NOW - 20 * DAY,
    trialEnd: NOW - 6 * DAY,
    firstPaidAt: NOW - 6 * DAY + 3600_000,
  })
  const all = [trialConvertedNow, trialLapsed, trialPaidThenChurned, trialRunning, direct, stampedTrial]

  it("100 %-rabattert abonnement er gratis: ikke betalende, ingen MRR, ingen churn", () => {
    const comp = sub({ id: "g", status: "active", mrrNok: 0, startedAt: NOW - 3 * DAY })
    const compChurned = sub({
      id: "h",
      status: "canceled",
      mrrNok: 0,
      startedAt: NOW - 10 * DAY,
      endedAt: NOW - 9 * DAY,
    })
    const abandoned = sub({
      id: "i",
      status: "canceled",
      startedAt: NOW - 10 * DAY,
      endedAt: NOW - 10 * DAY + 60_000,
    })
    expect(payingSince(abandoned, NOW)).toBeNull()
    expect(isPayingNow(comp)).toBe(false)
    expect(isCompedNow(comp)).toBe(true)
    expect(payingSince(comp, NOW)).toBeNull()
    expect(churnWindow([comp, compChurned], NOW - 30 * DAY, NOW, NOW)).toEqual({
      churned: 0,
      payingAtStart: 0,
      rate: null,
    })
    const kpis = computeKpis([...all, comp], NOW)
    expect(kpis.comped).toBe(1)
    expect(kpis.paying).toBe(3)
  })

  it("kortfri prøve → nytt betalende abonnement i samme bedrift teller som konvertert", () => {
    const lapsedTrial = sub({
      id: "t1",
      companyId: "firma-x",
      status: "canceled",
      trialStart: NOW - 30 * DAY,
      trialEnd: NOW - 16 * DAY,
      endedAt: NOW - 16 * DAY,
    })
    const newDirect = sub({
      id: "t2",
      companyId: "firma-x",
      status: "active",
      startedAt: NOW - 16 * DAY + 3600_000,
    })
    const otherCompanyTrial = sub({
      id: "t3",
      companyId: "firma-y",
      status: "canceled",
      trialStart: NOW - 30 * DAY,
      trialEnd: NOW - 16 * DAY,
      endedAt: NOW - 16 * DAY,
    })
    const marked = markTrialConversionsAcrossSubscriptions(
      [lapsedTrial, newDirect, otherCompanyTrial],
      (s) => s.companyId,
      NOW
    )
    expect(trialConverted(marked[0], NOW)).toBe(true)
    expect(trialConverted(marked[2], NOW)).toBe(false)
    // Ikke dobbelt: prøven er konvertert, men betalingen starter på det nye abonnementet.
    expect(payingSince(marked[0], NOW)).toBeNull()
    expect(trialCohort(marked, NOW - 90 * DAY, NOW, NOW)).toEqual({ trials: 2, converted: 1, rate: 0.5 })
    expect(mrrAt(marked, NOW, NOW)).toBe(690)
  })

  it("skiller utløpt prøve fra betalt prøve", () => {
    expect(trialConverted(trialConvertedNow, NOW)).toBe(true)
    expect(trialConverted(trialLapsed, NOW)).toBe(false)
    expect(trialConverted(trialPaidThenChurned, NOW)).toBe(true)
    expect(trialConverted(trialRunning, NOW)).toBe(false)
    expect(payingSince(trialLapsed, NOW)).toBeNull()
    expect(payingSince(stampedTrial, NOW)).toBe(stampedTrial.firstPaidAt)
    expect(payingSince(direct, NOW)).toBe(direct.startedAt)
  })

  it("kohort: bare modne prøver, riktig andel", () => {
    const cohort = trialCohort(all, NOW - 90 * DAY, NOW, NOW)
    // a (konvertert), b (utløpt), f (konvertert); d er ikke moden; c er eldre enn 90 d.
    expect(cohort).toEqual({ trials: 3, converted: 2, rate: 2 / 3 })
  })

  it("churn: betalt-og-avsluttet teller, utløpt prøve gjør det ikke", () => {
    const churn = churnWindow(all, NOW - 30 * DAY, NOW, NOW)
    // Betalende for 30 d siden: a (fra -26 d? nei, -26 < -30 er usant → a ble betalende ETTER vinduets start), c, e.
    expect(churn.payingAtStart).toBe(2)
    expect(churn.churned).toBe(1)
    expect(churn.rate).toBe(0.5)
  })

  it("MRR teller bare betalende nå, og kan regnes tilbake i tid", () => {
    expect(mrrAt(all, NOW, NOW)).toBe(690 + 299 + 690)
    expect(mrrAt(all, NOW - 30 * DAY, NOW)).toBe(299 + 299)
    const kpis = computeKpis(all, NOW)
    expect(kpis.paying).toBe(3)
    expect(kpis.trialing).toBe(1)
    expect(kpis.payingByPlan).toEqual({ proff: 3 })
    expect(kpis.mrr - kpis.mrr30dAgo).toBe(690 + 690 - 299)
  })

  it("månedsrader: seks måneder, nyeste sist, nøkkeltall per måned", () => {
    const rows = monthlyRows(all, 6, NOW)
    expect(rows).toHaveLength(6)
    expect(rows[5].month).toBe("2026-10")
    const sept = rows.find((r) => r.month === "2026-09")!
    // a og b startet prøve 30.–31. aug (NOW-40d = 30. aug); f startet 19. sep.
    expect(sept.newTrials).toBe(1)
    expect(sept.converted).toBe(1)
    expect(sept.churned).toBe(1) // c avsluttet 29. sep
    const okt = rows[5]
    expect(okt.newTrials).toBe(1) // d
    expect(okt.churned).toBe(0)
    expect(okt.mrrEnd).toBe(690 + 299 + 690)
  })
})
