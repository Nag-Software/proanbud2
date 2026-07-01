import { cache } from "react"

import { createClient } from "@/lib/supabase/server"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { hasRoleAccess, normalizeRole, type CanonicalRole } from "@/lib/roles"
import { MOCK_ROLE_COOKIE, canonicalMockRole, isRoleMockEnabled } from "@/lib/auth/role-mock"

// `cache()` dedupes this within a single render: the layout and the page both
// call checkRoleAccess, and several pages re-resolve the role — without this the
// getUser + user_roles + users reads run 2-3× per request. Per-user/per-request
// only (the result never crosses requests), so no cross-tenant leakage.
export const getCurrentUserRole = cache(async function getCurrentUserRole(): Promise<{
  user: { id: string; email?: string }
  userRole: string | null
  canonicalRole: CanonicalRole | null
}> {
  const supabase = await createClient()
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()

  if (authError || !user) {
    redirect("/login")
  }

  // Both reads key only on user.id and are independent — run them concurrently.
  const [{ data: userRoleData }, { data: userTableData }] = await Promise.all([
    supabase
      .from("user_roles")
      .select("roles(name)")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("users")
      .select("role, is_active")
      .eq("id", user.id)
      .maybeSingle(),
  ])

  // Deaktiverte kontoer skal ikke inn i appen i det hele tatt.
  if (userTableData?.is_active === false) {
    redirect("/konto-deaktivert")
  }

  // @ts-expect-error Supabase nested relation typing
  const userRole = userRoleData?.roles?.name || userTableData?.role || null
  const canonicalRole = normalizeRole(userRole)

  // Dev role mock (?mock=worker|pm|admin) — overrides role gating only.
  if (isRoleMockEnabled()) {
    const mockValue = (await cookies()).get(MOCK_ROLE_COOKIE)?.value
    const mockedRole = canonicalMockRole(mockValue)
    if (mockedRole) {
      return { user, userRole: mockedRole, canonicalRole: mockedRole }
    }
  }

  return { user, userRole, canonicalRole }
})

export async function checkRoleAccess(allowedRoles?: string[]) {
  const { user, userRole, canonicalRole } = await getCurrentUserRole()

  // Workers have a restricted surface; send them to their landing page
  // (projects) rather than the dashboard, which they cannot access.
  const fallbackPath = canonicalRole === "worker" ? "/prosjekter" : "/"

  if (allowedRoles) {
    if (!hasRoleAccess(userRole, allowedRoles)) {
      redirect(fallbackPath)
    }
  } else if (canonicalRole === "worker") {
    redirect("/prosjekter")
  }

  return { user, userRole, canonicalRole }
}
