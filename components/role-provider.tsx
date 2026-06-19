"use client"

import React, { createContext, useContext, useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/components/auth-provider"
import { normalizeRole, type CanonicalRole } from "@/lib/roles"
import { readMockRoleFromDocument } from "@/lib/auth/role-mock"

type RoleContextValue = {
  role: string | null
  canonicalRole: CanonicalRole | null
  loadingRole: boolean
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  canonicalRole: null,
  loadingRole: true,
})

/**
 * Fetches the current user's role ONCE per session and shares it via context.
 * Previously every component calling useUserRole issued its own pair of DB
 * queries on each navigation (sidebar, nav, banners, gates...), which added up
 * to 10+ redundant round trips per page load.
 */
export function RoleProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const [state, setState] = useState<RoleContextValue>({
    role: null,
    canonicalRole: null,
    loadingRole: true,
  })

  useEffect(() => {
    let active = true

    async function loadRole() {
      if (authLoading) return
      if (!user) {
        if (active) setState({ role: null, canonicalRole: null, loadingRole: false })
        return
      }

      // Dev role mock (?mock=worker|pm|admin) — UI-only override.
      const mockedRole = readMockRoleFromDocument()
      if (mockedRole) {
        if (active) setState({ role: mockedRole, canonicalRole: mockedRole, loadingRole: false })
        return
      }

      const supabase = createClient()
      const [{ data: userRoleData }, { data: userTableData }] = await Promise.all([
        supabase.from("user_roles").select("roles(name)").eq("user_id", user.id).maybeSingle(),
        supabase.from("users").select("role").eq("id", user.id).maybeSingle(),
      ])

      // @ts-expect-error Supabase nested relation typing
      const effectiveRole = userRoleData?.roles?.name || userTableData?.role || null
      if (active) {
        setState({
          role: effectiveRole,
          canonicalRole: normalizeRole(effectiveRole),
          loadingRole: false,
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
