import { cache } from "react"

import {
  hasBillableAccess,
  hasFeature,
  isTrialStatus,
  type FeatureKey,
  type PlanKey,
} from "@/lib/billing/plans"
import { createAdminClient } from "@/lib/supabase/admin"
import { getServerAuthContext } from "@/lib/auth/server-context"

/**
 * Kastes av plan-/modulveggene så actions kan kjenne igjen veggen og returnere
 * `code: "plan_upgrade"` til klienten (som da viser en «Se abonnement»-knapp
 * i stedet for en ren feilmelding uten vei videre).
 */
export class PlanUpgradeRequiredError extends Error {}

export async function assertCompanyHasModule(
  companyId: string | null | undefined,
  moduleKey: string,
  moduleLabel: string
): Promise<void> {
  if (!companyId || !(await companyHasModule(companyId, moduleKey))) {
    throw new PlanUpgradeRequiredError(
      `${moduleLabel} er ikke aktivert. Gå til Min bedrift → Betaling for å aktivere modulen.`
    )
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
  // Fast path: the shared auth context already read this user's profile in the
  // same render (pages call checkRoleAccess immediately before this), so the
  // company id is usually in hand and this costs zero queries. Only trust it for
  // the SAME user id the caller asked about.
  const context = await getServerAuthContext()
  if (context && context.user.id === userId && context.companyId) {
    return context.companyId
  }

  // Fallback keeps the admin client on purpose: it bypasses RLS, so a user whose
  // own `users` row is not selectable still resolves their company instead of
  // being bounced to /create-company.
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
type PlanAndModules = { plan: PlanKey | null; modules: string[]; status: string | null }

// React cache() deler bare innenfor én render. Server-actions er egne
// forespørsler, så hver fane på prosjektsiden leste company_billing +
// company_modules på nytt — to kall per action. Denne korte minnecachen (per
// serverinstans) deler svaret på tvers av forespørsler i 30 sekunder. Et
// planbytte slår dermed igjennom innen et halvt minutt; porten er fortsatt
// server-side, og RLS er uberørt.
const PLAN_CACHE_TTL_MS = 30_000
const planCache = new Map<string, { at: number; value: Promise<PlanAndModules> }>()

export const getCompanyPlanAndModules = cache(async function getCompanyPlanAndModules(
  companyId: string
): Promise<PlanAndModules> {
  const hit = planCache.get(companyId)
  if (hit && Date.now() - hit.at < PLAN_CACHE_TTL_MS) return hit.value
  const read = readCompanyPlanAndModules(companyId)
  const value = read.then((result) => result.value)
  planCache.set(companyId, { at: Date.now(), value })
  // Bare vellykkede lesinger caches. En forbigående feil gir samme svar som
  // før (ingen plan = lukket), men låser ikke funksjoner i 30 sekunder.
  read.then(
    (result) => {
      if (!result.ok && planCache.get(companyId)?.value === value) planCache.delete(companyId)
    },
    () => {
      if (planCache.get(companyId)?.value === value) planCache.delete(companyId)
    }
  )
  return value
})

async function readCompanyPlanAndModules(
  companyId: string
): Promise<{ ok: boolean; value: PlanAndModules }> {
  const admin = createAdminClient()
  const [{ data: billing, error: billingError }, { data: modules, error: modulesError }] = await Promise.all([
    admin
      .from("company_billing")
      .select("plan_key, status")
      .eq("company_id", companyId)
      .maybeSingle(),
    admin.from("company_modules").select("module_key").eq("company_id", companyId),
  ])
  return {
    ok: !billingError && !modulesError,
    value: {
      plan: (billing?.plan_key ?? null) as PlanKey | null,
      modules: (modules ?? []).map((m) => m.module_key as string),
      status: (billing?.status ?? null) as string | null,
    },
  }
}

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
    throw new PlanUpgradeRequiredError(
      `${featureLabel} krever Proff-abonnement. Oppgrader under Min bedrift → Betaling.`
    )
  }
}
