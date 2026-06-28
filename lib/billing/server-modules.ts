import { cache } from "react"

import {
  hasBillableAccess,
  hasFeature,
  isTrialStatus,
  type FeatureKey,
  type PlanKey,
} from "@/lib/billing/plans"
import { createAdminClient } from "@/lib/supabase/admin"

export async function assertCompanyHasModule(
  companyId: string | null | undefined,
  moduleKey: string,
  moduleLabel: string
): Promise<void> {
  if (!companyId || !(await companyHasModule(companyId, moduleKey))) {
    throw new Error(`${moduleLabel} er ikke aktivert. Gå til abonnement for å aktivere modulen.`)
  }
}

export async function companyHasModule(companyId: string, moduleKey: string): Promise<boolean> {
  // Status-aware: a company_modules row can outlive a lapsed subscription during
  // drift, so require the subscription to still be active/trialing.
  const { plan, modules, status } = await getCompanyPlanAndModules(companyId)
  void plan
  if (isTrialStatus(status)) return true // trial = every module unlocked
  if (!hasBillableAccess(status)) return false
  return modules.includes(moduleKey)
}

// `cache()`-wrapped (keyed by userId): several pages resolve the company id and
// then immediately resolve its plan/modules; this dedupes the lookup within one
// render so we don't re-read `users` for the same user multiple times.
export const getCurrentCompanyIdForUser = cache(async function getCurrentCompanyIdForUser(
  userId: string
): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("users")
    .select("company_id")
    .eq("id", userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data?.company_id ?? null
})

/**
 * Resolve a company's plan + enabled modules in one admin-client read.
 * The admin client bypasses RLS, so this works regardless of the caller's role.
 */
// `cache()`-wrapped (keyed by companyId): `companyHasFeature` is often called
// several times per render for different features on the same company. Caching
// here collapses those into a single billing+modules read per company per render.
export const getCompanyPlanAndModules = cache(async function getCompanyPlanAndModules(
  companyId: string
): Promise<{ plan: PlanKey | null; modules: string[]; status: string | null }> {
  const admin = createAdminClient()
  const [{ data: billing }, { data: modules }] = await Promise.all([
    admin
      .from("company_billing")
      .select("plan_key, status")
      .eq("company_id", companyId)
      .maybeSingle(),
    admin.from("company_modules").select("module_key").eq("company_id", companyId),
  ])
  return {
    plan: (billing?.plan_key ?? null) as PlanKey | null,
    modules: (modules ?? []).map((m) => m.module_key as string),
    status: (billing?.status ?? null) as string | null,
  }
})

/**
 * Does this company have access to `feature`? Honors plan inclusion (Proff
 * bundles the proff-only features) and the hybrid module fallback (e.g.
 * `integrasjoner` can be bought as a standalone module on Mini).
 *
 * Status-aware: a lapsed subscription (canceled/past_due/unpaid/incomplete)
 * grants no paid feature even if a stale plan_key/module row lingers from drift.
 */
export async function companyHasFeature(
  companyId: string | null | undefined,
  feature: FeatureKey
): Promise<boolean> {
  if (!companyId) return false
  const { plan, modules, status } = await getCompanyPlanAndModules(companyId)
  if (isTrialStatus(status)) return true // trial = every feature unlocked
  if (!hasBillableAccess(status)) return false
  return hasFeature(plan, modules, feature)
}

/**
 * Throw-on-miss plan-feature guard for server actions — the plan-level analogue
 * of `assertCompanyHasModule`. Use at the top of any server action that powers
 * a Proff-only feature.
 */
export async function assertPlanFeature(
  companyId: string | null | undefined,
  feature: FeatureKey,
  featureLabel: string
): Promise<void> {
  if (!(await companyHasFeature(companyId, feature))) {
    throw new Error(`${featureLabel} krever Proff-abonnement. Oppgrader under abonnement for å aktivere.`)
  }
}
