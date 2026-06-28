import { getRoleDisplayName } from "@/lib/roles"
import { useRoleContext } from "@/components/role-provider"
import { hasFeature as resolveFeature, isTrialStatus, type FeatureKey } from "@/lib/billing/plans"

/**
 * Reads the current user's role + plan context from the shared RoleProvider
 * context. Both are fetched once per session by the provider — this hook
 * performs no network requests, so it is cheap to use in many components.
 *
 * Plan helpers (`isProff`, `hasFeature`, `hasModule`) drive client-side gating
 * of Proff-only features. Remember: client gating is UX only — every gated
 * route is also enforced server-side.
 */
export function useUserRole() {
  const { role, canonicalRole, loadingRole, planKey, enabledModules, status, planKnown } =
    useRoleContext()

  // During the free trial every feature/module is unlocked regardless of the
  // chosen plan or purchased modules — mirrors the server gates so the UI never
  // shows an upsell/lock for something the trial company can actually use.
  const isTrialing = isTrialStatus(status)

  return {
    role,
    canonicalRole,
    displayRole: getRoleDisplayName(role),
    loadingRole,
    isWorker: canonicalRole === "worker",
    isManager: canonicalRole === "manager",
    isAdmin: canonicalRole === "admin",
    planKey,
    enabledModules,
    // Fail open when the plan context could not be resolved (planKnown === false),
    // so a missing migration / transient RPC error never hides paid Proff features.
    isProff: planKnown ? isTrialing || planKey === "proff" : true,
    hasModule: (moduleKey: string) =>
      planKnown ? isTrialing || enabledModules.includes(moduleKey) : true,
    hasFeature: (feature: FeatureKey) =>
      planKnown ? isTrialing || resolveFeature(planKey, enabledModules, feature) : true,
  }
}
