import type { BillingInterval, PlanKey } from "@/lib/billing/plans"

export type BillingStatus =
  | "incomplete"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused"

export type CompanyBillingRow = {
  company_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan_key: PlanKey | null
  billing_interval: BillingInterval | null
  status: BillingStatus
  trial_ends_at: string | null
  current_period_start: string | null
  current_period_end: string | null
  quota_limit: number
  included_seats: number
  stripe_seat_subscription_item_id: string | null
}

export type UsageSummary = {
  has_billing: boolean
  status: BillingStatus | string
  plan_key: PlanKey | null
  billing_interval: BillingInterval | null
  quota_limit: number
  used: number
  overage: number
  period_start: string | null
  period_end: string | null
  trial_ends_at: string | null
  included_seats: number
  seat_count: number
  billable_seats: number
  chargeable_seats: number
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  recorded?: boolean
}

export type CompanyModuleRow = {
  company_id: string
  module_key: string
  enabled_at: string
  stripe_subscription_item_id: string | null
}
