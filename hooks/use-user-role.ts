"use client"

import { useEffect, useSyncExternalStore } from "react"

import { getRoleDisplayName, normalizeRole, type CanonicalRole } from "@/lib/roles"
import { useRoleContext } from "@/components/role-provider"
import { useAuth } from "@/components/auth-provider"
import { readMockRoleFromDocument } from "@/lib/auth/role-mock"
import { hasFeature as resolveFeature, isTrialStatus, type FeatureKey } from "@/lib/billing/plans"

/**
 * Rolle-cache i localStorage så nav/sidebar kan vise riktig meny fra første
 * klientframe ved kald start, i stedet for å blinke admin-menyen mens rollen
 * hentes fra databasen. Nøkkelen inkluderer bruker-id, så en annen konto på
 * samme maskin aldri treffer feil cache — dermed trengs heller ingen
 * opprydding i de mange logout-stiene. Dette er kun UI-bootstrap: serveren
 * håndhever alltid reell tilgang på hver gated rute.
 */
const ROLE_CACHE_PREFIX = "proanbud.role-cache."

const roleCacheKey = (userId: string) => `${ROLE_CACHE_PREFIX}${userId}`

function readCachedRole(userId: string | null): CanonicalRole | null {
  // SSR-hygiene: på serveren (og før auth har seedet bruker-id på klienten)
  // finnes ingen cache — da er rollen rett og slett ukjent.
  if (!userId || typeof window === "undefined") return null
  // Dev-mocken (?mock=worker|pm|admin) vinner over cachen så mock-økter ikke
  // flimrer innom den ekte (cachede) rollen først.
  const mocked = readMockRoleFromDocument()
  if (mocked) return mocked
  try {
    return normalizeRole(window.localStorage.getItem(roleCacheKey(userId)))
  } catch {
    return null // localStorage utilgjengelig (f.eks. privat modus)
  }
}

// Cachen skrives bare av effekten i hooken under, som trigges av samme fetch
// som uansett re-rendrer alle konsumenter — så subscribe kan være en no-op.
const subscribeNoop = () => () => {}

/**
 * Reads the current user's role + plan context from the shared RoleProvider
 * context. Both are fetched once per session by the provider — this hook
 * performs no network requests, so it is cheap to use in many components.
 *
 * The canonical role is additionally seeded from a per-user localStorage cache
 * so returning users get the correct role-dependent UI on the very first
 * client frame (no admin-nav flash for workers on cold start). `roleKnown`
 * tells consumers whether the role is safe to act on yet — when it is false,
 * render neutral skeletons instead of guessing.
 *
 * Plan helpers (`isProff`, `hasFeature`, `hasModule`) drive client-side gating
 * of Proff-only features. Remember: client gating is UX only — every gated
 * route is also enforced server-side.
 */
export function useUserRole() {
  const {
    role,
    canonicalRole: fetchedCanonicalRole,
    loadingRole,
    planKey,
    enabledModules,
    status,
    planKnown,
  } = useRoleContext()
  const { user } = useAuth()
  const userId: string | null = user?.id ?? null

  // useSyncExternalStore med server-snapshot null gir samme markup på server
  // og under hydrering (ingen hydration-mismatch), og bytter til cache-verdien
  // så snart klienten kjenner bruker-id-en.
  const cachedRole = useSyncExternalStore(
    subscribeNoop,
    () => readCachedRole(userId),
    () => null
  )

  // Fetch-resultatet vinner alltid når det finnes; cachen fyller bare gapet
  // mens vi venter (kald start, eller vinduet rett etter kontobytte).
  const effectiveCanonicalRole = fetchedCanonicalRole ?? cachedRole
  // Rollen er «kjent» når fetchen er ferdig ELLER cachen ga svar for denne
  // brukeren. Før det skal nav/sidebar vise nøytrale skeletons — aldri gjette.
  const roleKnown = !loadingRole || effectiveCanonicalRole !== null

  // Oppdater cachen når fetchen svarer — og aldri med dev-mock-rollen, så
  // mock-testing ikke forgifter neste ekte kaldstart.
  useEffect(() => {
    if (loadingRole || !userId || !fetchedCanonicalRole) return
    if (readMockRoleFromDocument()) return
    try {
      const key = roleCacheKey(userId)
      if (window.localStorage.getItem(key) === fetchedCanonicalRole) return
      // Rydd bort andre brukeres poster så det bare ligger én cache-post
      // igjen om gangen (hygiene ved kontobytte på samme maskin).
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i)
        if (k && k.startsWith(ROLE_CACHE_PREFIX) && k !== key) {
          window.localStorage.removeItem(k)
        }
      }
      window.localStorage.setItem(key, fetchedCanonicalRole)
    } catch {
      // localStorage utilgjengelig (privat modus) — da gjelder bare dagens
      // oppførsel: rollen er ukjent til fetchen svarer.
    }
  }, [loadingRole, userId, fetchedCanonicalRole])

  // During the free trial every feature/module is unlocked regardless of the
  // chosen plan or purchased modules — mirrors the server gates so the UI never
  // shows an upsell/lock for something the trial company can actually use.
  const isTrialing = isTrialStatus(status)

  return {
    role,
    canonicalRole: effectiveCanonicalRole,
    displayRole: getRoleDisplayName(role),
    loadingRole,
    /**
     * True når rollen er trygt kjent — enten ferdig hentet, eller lest fra
     * per-bruker-cachen. Vis nøytrale skeletons (ikke admin-UI) når false.
     */
    roleKnown,
    isWorker: effectiveCanonicalRole === "worker",
    isManager: effectiveCanonicalRole === "manager",
    isAdmin: effectiveCanonicalRole === "admin",
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
