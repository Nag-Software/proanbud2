import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useAuth } from "@/components/auth-provider"
import { normalizeRole, type CanonicalRole, getRoleDisplayName } from "@/lib/roles"

export function useUserRole() {
  const { user } = useAuth()
  const [role, setRole] = useState<string | null>(null)
  const [canonicalRole, setCanonicalRole] = useState<CanonicalRole | null>(null)
  const [loadingRole, setLoadingRole] = useState(true)

  useEffect(() => {
    async function fetchRole() {
      if (!user) {
        setRole(null)
        setCanonicalRole(null)
        setLoadingRole(false)
        return
      }

      const supabase = createClient()

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
      const effectiveRole = userRoleData?.roles?.name || userTableData?.role || null
      const normalized = normalizeRole(effectiveRole)

      setRole(effectiveRole)
      setCanonicalRole(normalized)
      setLoadingRole(false)
    }

    fetchRole()
  }, [user])

  return {
    role,
    canonicalRole,
    displayRole: getRoleDisplayName(role),
    loadingRole,
    isWorker: canonicalRole === "worker",
    isManager: canonicalRole === "manager",
    isAdmin: canonicalRole === "admin",
  }
}
