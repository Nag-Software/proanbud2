import {
  planPricingFor,
  type BillingInterval,
  type PlanKey,
  type PriceCohort,
} from "@/lib/billing/plans"

/** Recurring commission share of collected subscription revenue. */
export const COMMISSION_RATE = 0.05

const ACTIVE_BILLING_STATUSES = new Set(["active", "trialing"])

export function isActiveBillingStatus(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE_BILLING_STATUSES.has(status))
}

/** Monthly subscription price (kr) for a plan/interval, or 0 if unknown. */
export function monthlyPriceNok(
  planKey: string | null | undefined,
  interval: string | null | undefined,
  cohort: PriceCohort = "current",
): number {
  if (planKey !== "mini" && planKey !== "proff") return 0
  const iv: BillingInterval = interval === "year" ? "year" : "month"
  return planPricingFor(cohort)[planKey as PlanKey][iv].monthlyNok
}

/** Recurring monthly commission (kr) for one active subscription = 5% of price. */
export function recurringCommissionNok(
  planKey: string | null | undefined,
  interval: string | null | undefined,
  cohort: PriceCohort = "current",
): number {
  return Math.round(monthlyPriceNok(planKey, interval, cohort) * COMMISSION_RATE)
}

/** One-time engangsbonus (kr) when a referral converts = full first month. */
export function firstMonthBonusNok(
  planKey: string | null | undefined,
  interval: string | null | undefined,
  cohort: PriceCohort = "current",
): number {
  return monthlyPriceNok(planKey, interval, cohort)
}
