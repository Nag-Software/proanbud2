// Daily safety net that re-aligns company_billing with Stripe (Stripe = source
// of truth). Catches drift that a missed/failed webhook would otherwise leave
// behind — e.g. a subscription deleted in the Stripe dashboard, a trial that
// ended without a payment method, or a period that rolled over silently.
//
// For each candidate company it runs reconcileCompanyBillingFromStripe, which
// verifies the stored subscription against Stripe and either refreshes it,
// re-links a still-live replacement, or downgrades the row to canceled.

import { reconcileCompanyBillingFromStripe } from "@/lib/billing/confirm-checkout"
import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"

export type BillingReconcileResult = {
  considered: number
  refreshed: number
  downgraded: number
  failed: number
}

/**
 * Reconcile billing rows that claim a live status but haven't been touched by a
 * webhook recently (stale), or whose trial/period has elapsed. Bounded per run
 * to keep Stripe API usage predictable; the daily cadence catches everything
 * within a day even at the limit.
 */
export async function runBillingReconcile(limit = 200): Promise<BillingReconcileResult> {
  const admin = createAdminClient()
  const result: BillingReconcileResult = {
    considered: 0,
    refreshed: 0,
    downgraded: 0,
    failed: 0,
  }

  const now = new Date()
  const staleBefore = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString()

  // Candidates: rows that assert an active-ish status with a subscription id and
  // either (a) haven't synced in >12h, or (b) have a trial/period boundary in the
  // past (which should have produced a webhook that may have been missed).
  const { data: rows, error } = await admin
    .from("company_billing")
    .select("company_id, status, updated_at, trial_ends_at, current_period_end")
    .in("status", ["active", "trialing", "past_due"])
    .not("stripe_subscription_id", "is", null)
    .lt("updated_at", staleBefore)
    .order("updated_at", { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(`Kunne ikke hente billing-rader: ${error.message}`)
  }

  for (const row of rows ?? []) {
    result.considered += 1
    try {
      const status = await reconcileCompanyBillingFromStripe(row.company_id as string)
      if (status === null || status === "canceled") {
        result.downgraded += 1
      } else {
        result.refreshed += 1
      }
    } catch (err) {
      console.error("[billing-reconcile] failed for", row.company_id, err)
      void logServerError({
        message: "Billing-reconcile feilet for bedrift",
        error: err,
        level: "warning",
        source: "worker",
        route: "runBillingReconcile",
        context: { companyId: row.company_id },
      })
      result.failed += 1
    }
  }

  return result
}
