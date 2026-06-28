"use client"

import React, { createContext, useContext, useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/components/auth-provider"
import { normalizeRole, type CanonicalRole } from "@/lib/roles"
import { readMockRoleFromDocument } from "@/lib/auth/role-mock"
import { reportClientError } from "@/lib/errors/client"
import type { PlanKey } from "@/lib/billing/plans"

type RoleContextValue = {
  role: string | null
  canonicalRole: CanonicalRole | null
  loadingRole: boolean
  planKey: PlanKey | null
  enabledModules: string[]
  /**
   * Raw billing status from the plan-context RPC (e.g. "trialing", "active").
   * During an active trial EVERY feature/module is unlocked, so useUserRole
   * short-circuits its gates when this is "trialing".
   */
  status: string | null
  /**
   * Whether the plan context was resolved successfully. False means the RPC
   * failed (e.g. the get_company_plan_context migration is not applied yet).
   * Consumers fail OPEN when this is false so a missing migration degrades to
   * "show features" rather than silently hiding paid Proff features — the server
   * still enforces real access on every gated route.
   */
  planKnown: boolean
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  canonicalRole: null,
  loadingRole: true,
  planKey: null,
  enabledModules: [],
  status: null,
  planKnown: false,
})

type PlanContextRow = {
  plan_key?: PlanKey | null
  enabled_modules?: string[] | null
  status?: string | null
}

function readPlan(data: PlanContextRow | null | undefined): {
  planKey: PlanKey | null
  enabledModules: string[]
  status: string | null
} {
  return {
    planKey: (data?.plan_key ?? null) as PlanKey | null,
    enabledModules: (data?.enabled_modules ?? []) as string[],
    status: (data?.status ?? null) as string | null,
  }
}

/**
 * Fetches the current user's role AND plan context ONCE per session and shares
 * them via context. Previously every component calling useUserRole issued its
 * own pair of DB queries on each navigation (sidebar, nav, banners, gates...),
 * which added up to 10+ redundant round trips per page load.
 *
 * The plan context (plan_key + enabled modules) comes from the worker-safe
 * `get_company_plan_context` RPC (SECURITY DEFINER) so managers and workers can
 * drive plan-gated UI without admin-only billing access. This is display/nav
 * only — every gated route still enforces the plan server-side.
 */
export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [state, setState] = useState<RoleContextValue>({
    role: null,
    canonicalRole: null,
    loadingRole: true,
    planKey: null,
    enabledModules: [],
    status: null,
    planKnown: false,
  })

  useEffect(() => {
    let active = true

    async function loadRole() {
      if (authLoading) return
      if (!user) {
        if (active)
          setState({
            role: null,
            canonicalRole: null,
            loadingRole: false,
            planKey: null,
            enabledModules: [],
            status: null,
            planKnown: true,
          })
        return
      }

      const supabase = createClient()
      const planPromise = supabase.rpc("get_company_plan_context")

      // Dev role mock (?mock=worker|pm|admin) — UI-only role override. Plan is
      // still read from the real company so plan-gated UI reflects reality.
      const mockedRole = readMockRoleFromDocument()
      if (mockedRole) {
        const { data: planData, error: planError } = await planPromise
        if (planError) {
          console.error("get_company_plan_context failed", planError)
          reportClientError(planError, {
            level: "warning",
            context: { action: "load-plan-context", userId: user.id },
          })
        }
        if (active)
          setState({
            role: mockedRole,
            canonicalRole: mockedRole,
            loadingRole: false,
            planKnown: !planError,
            ...readPlan(planData as PlanContextRow),
          })
        return
      }

      const [{ data: userRoleData }, { data: userTableData }, { data: planData, error: planError }] =
        await Promise.all([
          supabase.from("user_roles").select("roles(name)").eq("user_id", user.id).maybeSingle(),
          supabase.from("users").select("role").eq("id", user.id).maybeSingle(),
          planPromise,
        ])

      if (planError) {
        console.error("get_company_plan_context failed", planError)
        reportClientError(planError, {
          level: "warning",
          context: { action: "load-plan-context", userId: user.id },
        })
      }

      // @ts-expect-error Supabase nested relation typing
      const effectiveRole = userRoleData?.roles?.name || userTableData?.role || null
      if (active) {
        setState({
          role: effectiveRole,
          canonicalRole: normalizeRole(effectiveRole),
          loadingRole: false,
          planKnown: !planError,
          ...readPlan(planData as PlanContextRow),
        })
      }
    }

    void loadRole()
    return () => {
      active = false
    }
  }, [user, authLoading])

  return <RoleContext.Provider value={state}>{children}</RoleContext.Provider>
}

export function useRoleContext() {
  return useContext(RoleContext)
}
