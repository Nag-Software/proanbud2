import { createClient } from "@/lib/supabase/server"
import { redirect } from "next/navigation"

import { hasRoleAccess, normalizeRole, type CanonicalRole } from "@/lib/roles"

export async function getCurrentUserRole(): Promise<{
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

  const { data: userRoleData } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", user.id)
    .maybeSingle()

  const { data: userTableData } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .maybeSingle()

  // @ts-expect-error Supabase nested relation typing
  const userRole = userRoleData?.roles?.name || userTableData?.role || null
  const canonicalRole = normalizeRole(userRole)

  return { user, userRole, canonicalRole }
}

export async function checkRoleAccess(allowedRoles?: string[]) {
  const { user, userRole, canonicalRole } = await getCurrentUserRole()

  if (allowedRoles) {
    if (!hasRoleAccess(userRole, allowedRoles)) {
      redirect("/")
    }
  } else if (canonicalRole === "worker") {
    redirect("/")
  }

  return { user, userRole, canonicalRole }
}
