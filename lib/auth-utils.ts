import { cache } from "react"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { hasRoleAccess, normalizeRole, type CanonicalRole } from "@/lib/roles"
import { MOCK_ROLE_COOKIE, canonicalMockRole, isRoleMockEnabled } from "@/lib/auth/role-mock"
import { getServerAuthContext } from "@/lib/auth/server-context"

// Delegates to the shared per-request auth context, so a page's role check and
// the server actions it calls resolve the user ONCE instead of each re-reading
// user_roles + users (and each paying an auth round-trip). See
// lib/auth/server-context.ts for the measurements that motivated it.
//
// Still `cache()`-wrapped in its own right: the redirect decisions and the role
// mock below are this function's own contract, and layouts + pages both call it.
export const getCurrentUserRole = cache(async function getCurrentUserRole(): Promise<{
  user: { id: string; email?: string }
  userRole: string | null
  canonicalRole: CanonicalRole | null
}> {
  const context = await getServerAuthContext()

  if (!context) {
    redirect("/login")
  }

  // Deaktiverte kontoer skal ikke inn i appen i det hele tatt.
  if (!context.isActive) {
    redirect("/konto-deaktivert")
  }

  const user = context.user
  const userRole = context.role
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
