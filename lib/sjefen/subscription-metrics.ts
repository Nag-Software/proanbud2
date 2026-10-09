/**
 * Abonnementstall for /sjefen/abonnement — regnet rett fra Stripe.
 *
 * Hvorfor Stripe og ikke company_billing: raden per bedrift overskrives ved
 * hver synk, så databasen har ingen historikk. Stripe har den på hvert
 * abonnement (start_date, trial_start/trial_end, ended_at, canceled_at), og
 * Stripe er sannheten for hva som faktisk faktureres (seter, moduler,
 * 50 %-rabatten, velkomstrabatten). Ett listekall (paginert) per sidevisning,
 * cachet 5 min.
 *
 * Definisjoner (vises også som hjelpetekst på siden):
 *
 *   Betalende   status active eller past_due (purring = fortsatt kunde) OG
 *               månedsbeløp > 0. Abonnement med 100 % rabatt (egne, komp,
 *               test) er «gratis» og telles for seg — de betaler ingenting
 *               og skal hverken gi MRR, churn eller betaling-event.
 *   MRR         Σ(pris × antall) over abonnementets linjer for betalende,
 *               årspriser ÷ 12, minus gjeldende rabatt. Eks. mva, i kroner.
 *               Prøver teller ikke.
 *   Konvertert  prøve som ble betalende: status betalende nå, ELLER
 *               first_paid_at satt (db/114, eksakt framover), ELLER
 *               ended_at > trial_end + 3 dager, ELLER bedriften fikk et
 *               annet betalende abonnement etter prøvestart. Det siste er
 *               normalveien: en kortfri prøve uten kort kanselleres av
 *               Stripe PÅ trial_end (end_behavior missing_payment_method=
 *               cancel) og kunden tegner et NYTT abonnement via Checkout.
 *               Konvertering måles derfor per bedrift, ikke per abonnement.
 *   Prøve→bet.  kohort = prøver startet i vinduet med utløpt trial_end;
 *               andel av dem som konverterte.
 *   Churn       betalende abonnement avsluttet (ended_at) i vinduet, delt på
 *               antall betalende ved vinduets start. Prøver som bare utløp
 *               er IKKE churn — de står som «ikke konvertert».
 *
 * Alt under `compute*` er rene funksjoner over SubscriptionRecord, så de
 * testes uten nettverk (tests/sjefen/subscription-metrics.test.ts).
 */

import type Stripe from "stripe"

export const PAYING_STATUSES = new Set(["active", "past_due"])
const TRIAL_CONVERSION_GRACE_MS = 3 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

/** Flatt, serialiserbart bilde av ett Stripe-abonnement (ms-tidsstempler). */
export type SubscriptionRecord = {
  id: string
  customerId: string | null
  /** metadata.company_id fra Stripe; kan mangle for abonnementer laget utenfor appen. */
  companyId: string | null
  status: string
  planKey: string | null
  interval: "month" | "year" | null
  /** Månedlig beløp i kroner eks. mva etter rabatt, uavhengig av status. */
  mrrNok: number
  startedAt: number
  trialStart: number | null
  trialEnd: number | null
  endedAt: number | null
  canceledAt: number | null
  cancelAtPeriodEnd: boolean
}

type DiscountLike = {
  end: number | null
  coupon: { percent_off: number | null; amount_off: number | null; valid?: boolean } | null
}

function sec(value: number | null | undefined): number | null {
  return value ? value * 1000 : null
}

/** Månedlig beløp (kroner) for linjene på abonnementet, etter rabatt. */
export function monthlyAmountNok(
  items: Array<{
    quantity?: number | null
    price: {
      unit_amount: number | null
      recurring: { interval: string; interval_count: number } | null
    }
  }>,
  discounts: Array<string | DiscountLike> = [],
  now: number = Date.now()
): number {
  let yearlyOre = 0
  let monthlyOre = 0
  for (const item of items) {
    const unit = item.price.unit_amount ?? 0
    const quantity = item.quantity ?? 1
    const recurring = item.price.recurring
    if (!recurring) continue
    const count = Math.max(1, recurring.interval_count || 1)
    const total = unit * quantity
    switch (recurring.interval) {
      case "year":
        yearlyOre += total / count
        break
      case "month":
        monthlyOre += total / count
        break
      case "week":
        monthlyOre += (total / count) * (52 / 12)
        break
      case "day":
        monthlyOre += (total / count) * (365 / 12)
        break
    }
  }
  let monthlyTotal = monthlyOre + yearlyOre / 12

  for (const discount of discounts) {
    if (typeof discount === "string" || !discount.coupon) continue
    if (discount.end && discount.end * 1000 <= now) continue
    const { percent_off, amount_off } = discount.coupon
    if (percent_off) {
      monthlyTotal -= monthlyTotal * (percent_off / 100)
    } else if (amount_off) {
      // Beløpsrabatt trekkes per faktura — på årsfaktura er det 1/12 per måned.
      monthlyTotal -= yearlyOre > 0 && monthlyOre === 0 ? amount_off / 12 : amount_off
    }
  }

  return Math.max(0, Math.round(monthlyTotal) / 100)
}

function basePlanOf(sub: Stripe.Subscription): {
  planKey: string | null
  interval: "month" | "year" | null
} {
  for (const item of sub.items.data) {
    const meta = item.price.metadata ?? {}
    if (meta.kind && meta.kind !== "base") continue
    const planKey = meta.plan_key ?? meta.plan ?? null
    const interval = item.price.recurring?.interval
    if (planKey) {
      return {
        planKey,
        interval: interval === "year" || interval === "month" ? interval : null,
      }
    }
  }
  return { planKey: null, interval: null }
}

export function toSubscriptionRecord(
  sub: Stripe.Subscription,
  now: number = Date.now()
): SubscriptionRecord {
  const { planKey, interval } = basePlanOf(sub)
  return {
    id: sub.id,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null,
    companyId: sub.metadata?.company_id?.trim() || null,
    status: sub.status,
    planKey,
    interval,
    mrrNok: monthlyAmountNok(
      sub.items.data,
      (sub.discounts ?? []) as Array<string | DiscountLike>,
      now
    ),
    startedAt: sec(sub.start_date) ?? sec(sub.created) ?? now,
    trialStart: sec(sub.trial_start),
    trialEnd: sec(sub.trial_end),
    endedAt: sec(sub.ended_at),
    canceledAt: sec(sub.canceled_at),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  }
}

/* ────────────────────────── rene beregninger ────────────────────────── */

export type SubscriptionFacts = SubscriptionRecord & {
  /** Fra company_billing.first_paid_at (db/114) når den finnes. */
  firstPaidAt: number | null
  /**
   * Bedriften fikk et annet betalende abonnement etter at denne prøven
   * startet (kortfri prøve → nytt abonnement via Checkout). Settes av
   * datalaget med markTrialConversionsAcrossSubscriptions.
   */
  convertedViaOtherSubscription?: boolean
}

/** Lever og betaler faktisk noe. */
export function isPayingNow(sub: SubscriptionFacts): boolean {
  return PAYING_STATUSES.has(sub.status) && sub.mrrNok > 0
}

/** Lever, men 100 % rabattert (egne, komp, test). */
export function isCompedNow(sub: SubscriptionFacts): boolean {
  return PAYING_STATUSES.has(sub.status) && sub.mrrNok <= 0
}

/** Når abonnementet ble (eller blir) betalende — null hvis det aldri har betalt. */
export function payingSince(sub: SubscriptionFacts, now: number): number | null {
  if (sub.firstPaidAt) return sub.firstPaidAt
  // Uten stempel vet vi bare det Stripe viser nå: et 100 %-rabattert
  // abonnement har aldri betalt så langt vi kan se.
  if (sub.mrrNok <= 0) return null
  if (sub.trialEnd) {
    if (!trialConvertedOnOwn(sub, now)) return null
    return sub.trialEnd
  }
  if (sub.status === "incomplete" || sub.status === "incomplete_expired") return null
  // Avsluttet innen et døgn uten stempel: opprettet og angret/testet, ingen
  // faktura å snakke om. (Framover fanger first_paid_at de ekte tilfellene.)
  if (sub.status === "canceled" && sub.endedAt && sub.endedAt - sub.startedAt < DAY_MS) return null
  return sub.startedAt
}

/** Prøven på DETTE abonnementet gikk over til betaling (heuristikken i docblocken). */
function trialConvertedOnOwn(sub: SubscriptionFacts, now: number): boolean {
  if (!sub.trialEnd) return false
  if (sub.firstPaidAt) return true
  if (sub.trialEnd > now) return false
  if (sub.mrrNok <= 0) return false
  if (isPayingNow(sub)) return true
  if (sub.endedAt) return sub.endedAt - sub.trialEnd > TRIAL_CONVERSION_GRACE_MS
  // Prøven er utløpt, abonnementet lever, men status er hverken betalende
  // eller avsluttet (unpaid/paused): regnes ikke som konvertert.
  return false
}

/** Prøve som ble betalende — på samme abonnement eller et nytt i samme bedrift. */
export function trialConverted(sub: SubscriptionFacts, now: number): boolean {
  if (!sub.trialEnd) return false
  return Boolean(sub.convertedViaOtherSubscription) || trialConvertedOnOwn(sub, now)
}

/**
 * Sett convertedViaOtherSubscription på prøver der samme bedrift (companyKey)
 * senere fikk et annet abonnement som betaler. Returnerer nye objekter.
 */
export function markTrialConversionsAcrossSubscriptions<T extends SubscriptionFacts>(
  subs: T[],
  companyKey: (sub: T) => string | null,
  now: number
): T[] {
  const payingStartsByCompany = new Map<string, Array<{ id: string; since: number }>>()
  for (const sub of subs) {
    const key = companyKey(sub)
    if (!key) continue
    const since = payingSince(sub, now)
    if (since === null) continue
    const list = payingStartsByCompany.get(key) ?? []
    list.push({ id: sub.id, since })
    payingStartsByCompany.set(key, list)
  }
  return subs.map((sub) => {
    if (!sub.trialStart) return sub
    const key = companyKey(sub)
    if (!key) return sub
    const other = (payingStartsByCompany.get(key) ?? []).some(
      (entry) => entry.id !== sub.id && entry.since >= sub.trialStart!
    )
    return other ? { ...sub, convertedViaOtherSubscription: true } : sub
  })
}

export function wasPayingAt(sub: SubscriptionFacts, at: number, now: number): boolean {
  const since = payingSince(sub, now)
  if (since === null || since > at) return false
  if (sub.endedAt && sub.endedAt <= at) return false
  if (at >= now && !isPayingNow(sub)) return false
  return true
}

/** Betalende abonnement som ble avsluttet i [from, to). */
export function churnedIn(sub: SubscriptionFacts, from: number, to: number, now: number): boolean {
  if (!sub.endedAt || sub.endedAt < from || sub.endedAt >= to) return false
  const since = payingSince(sub, now)
  return since !== null && since < sub.endedAt
}

export type TrialCohort = { trials: number; converted: number; rate: number | null }

/** Prøver startet i [from, to) hvis trial_end er passert; andel konvertert. */
export function trialCohort(
  subs: SubscriptionFacts[],
  from: number,
  to: number,
  now: number
): TrialCohort {
  let trials = 0
  let converted = 0
  for (const sub of subs) {
    if (!sub.trialStart || !sub.trialEnd) continue
    if (sub.trialStart < from || sub.trialStart >= to) continue
    if (sub.trialEnd > now) continue
    trials += 1
    if (trialConverted(sub, now)) converted += 1
  }
  return { trials, converted, rate: trials > 0 ? converted / trials : null }
}

export type ChurnWindow = {
  churned: number
  payingAtStart: number
  rate: number | null
}

export function churnWindow(
  subs: SubscriptionFacts[],
  from: number,
  to: number,
  now: number
): ChurnWindow {
  let churned = 0
  let payingAtStart = 0
  for (const sub of subs) {
    if (wasPayingAt(sub, from, now)) payingAtStart += 1
    if (churnedIn(sub, from, to, now)) churned += 1
  }
  return { churned, payingAtStart, rate: payingAtStart > 0 ? churned / payingAtStart : null }
}

export function mrrAt(subs: SubscriptionFacts[], at: number, now: number): number {
  let total = 0
  for (const sub of subs) {
    if (wasPayingAt(sub, at, now)) total += sub.mrrNok
  }
  return Math.round(total)
}

export type MonthRow = {
  /** YYYY-MM */
  month: string
  label: string
  newTrials: number
  converted: number
  conversionRate: number | null
  newPaying: number
  churned: number
  mrrEnd: number
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export function monthlyRows(subs: SubscriptionFacts[], months: number, now: number): MonthRow[] {
  const rows: MonthRow[] = []
  const nowDate = new Date(now)
  for (let i = months - 1; i >= 0; i -= 1) {
    const from = startOfMonth(new Date(nowDate.getFullYear(), nowDate.getMonth() - i, 1))
    const to = new Date(from.getFullYear(), from.getMonth() + 1, 1)
    const fromMs = from.getTime()
    const toMs = Math.min(to.getTime(), now + 1)

    let newTrials = 0
    let converted = 0
    let newPaying = 0
    let churned = 0
    for (const sub of subs) {
      if (sub.trialStart && sub.trialStart >= fromMs && sub.trialStart < toMs) {
        newTrials += 1
        if (trialConverted(sub, now)) converted += 1
      }
      const since = payingSince(sub, now)
      if (since !== null && since >= fromMs && since < toMs) newPaying += 1
      if (churnedIn(sub, fromMs, toMs, now)) churned += 1
    }
    const mrrPoint = Math.min(to.getTime() - 1, now)
    rows.push({
      month: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}`,
      label: from.toLocaleDateString("nb-NO", { month: "short", year: "numeric" }),
      newTrials,
      converted,
      conversionRate: newTrials > 0 ? converted / newTrials : null,
      newPaying,
      churned,
      mrrEnd: mrrAt(subs, mrrPoint, now),
    })
  }
  return rows
}

export type SubscriptionKpis = {
  mrr: number
  mrr30dAgo: number
  paying: number
  payingByPlan: Record<string, number>
  /** Lever med 100 % rabatt — egne, komp og test. */
  comped: number
  trialing: number
  trialCohort90d: TrialCohort
  churn30d: ChurnWindow
}

export function computeKpis(subs: SubscriptionFacts[], now: number = Date.now()): SubscriptionKpis {
  const payingByPlan: Record<string, number> = {}
  let paying = 0
  let comped = 0
  let trialing = 0
  for (const sub of subs) {
    if (isPayingNow(sub)) {
      paying += 1
      const key = sub.planKey ?? "ukjent"
      payingByPlan[key] = (payingByPlan[key] ?? 0) + 1
    } else if (isCompedNow(sub)) {
      comped += 1
    } else if (sub.status === "trialing") {
      trialing += 1
    }
  }
  return {
    mrr: mrrAt(subs, now, now),
    mrr30dAgo: mrrAt(subs, now - 30 * DAY_MS, now),
    paying,
    payingByPlan,
    comped,
    trialing,
    trialCohort90d: trialCohort(subs, now - 90 * DAY_MS, now, now),
    churn30d: churnWindow(subs, now - 30 * DAY_MS, now, now),
  }
}
