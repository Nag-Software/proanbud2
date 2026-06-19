import { getRoleDisplayName } from "@/lib/roles"
import { useRoleContext } from "@/components/role-provider"

/**
 * Reads the current user's role from the shared RoleProvider context.
 * The role is fetched once per session by the provider — this hook performs
 * no network requests, so it is cheap to use in many components.
 */
export function useUserRole() {
  const { role, canonicalRole, loadingRole } = useRoleContext()

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
