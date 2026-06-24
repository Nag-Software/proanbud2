import { hasFeature, type FeatureKey, type PlanKey } from "@/lib/billing/plans"
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
  const admin = createAdminClient()
  const { data, error } = await admin
    .from("company_modules")
    .select("module_key")
    .eq("company_id", companyId)
    .eq("module_key", moduleKey)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return Boolean(data)
}

export async function getCurrentCompanyIdForUser(userId: string): Promise<string | null> {
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
}

/**
 * Resolve a company's plan + enabled modules in one admin-client read.
 * The admin client bypasses RLS, so this works regardless of the caller's role.
 */
export async function getCompanyPlanAndModules(
  companyId: string
): Promise<{ plan: PlanKey | null; modules: string[] }> {
  const admin = createAdminClient()
  const [{ data: billing }, { data: modules }] = await Promise.all([
    admin.from("company_billing").select("plan_key").eq("company_id", companyId).maybeSingle(),
    admin.from("company_modules").select("module_key").eq("company_id", companyId),
  ])
  return {
    plan: (billing?.plan_key ?? null) as PlanKey | null,
    modules: (modules ?? []).map((m) => m.module_key as string),
  }
}

/**
 * Does this company have access to `feature`? Honors plan inclusion (Proff
 * bundles the proff-only features) and the hybrid module fallback (e.g.
 * `integrasjoner` can be bought as a standalone module on Mini).
 */
export async function companyHasFeature(
  companyId: string | null | undefined,
  feature: FeatureKey
): Promise<boolean> {
  if (!companyId) return false
  const { plan, modules } = await getCompanyPlanAndModules(companyId)
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
