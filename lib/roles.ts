export type CanonicalRole = "admin" | "manager" | "worker"

export const ROLE_DISPLAY_NAMES: Record<CanonicalRole, string> = {
  admin: "Administrator",
  manager: "Prosjektleder",
  worker: "Håndverker",
}

export const ROLE_DB_VALUES: Record<CanonicalRole, string> = {
  admin: "admin",
  manager: "manager",
  worker: "worker",
}

const ROLE_ALIASES: Record<string, CanonicalRole> = {
  admin: "admin",
  administrator: "admin",
  manager: "manager",
  prosjektleder: "manager",
  leder: "manager",
  worker: "worker",
  handverker: "worker",
  håndverker: "worker",
  ansatt: "worker",
}

export function normalizeRole(role: string | null | undefined): CanonicalRole | null {
  const key = String(role || "").trim().toLowerCase()
  if (!key) return null
  return ROLE_ALIASES[key] || null
}

export function getRoleDisplayName(role: string | null | undefined): string {
  const canonical = normalizeRole(role)
  if (!canonical) return "Ukjent"
  return ROLE_DISPLAY_NAMES[canonical]
}

export function roleNameToDbValue(roleName: string): CanonicalRole | null {
  return normalizeRole(roleName)
}

export function roleNameToDisplay(canonical: CanonicalRole): string {
  return ROLE_DISPLAY_NAMES[canonical]
}

export function isAdmin(role: string | null | undefined): boolean {
  return normalizeRole(role) === "admin"
}

export function isManager(role: string | null | undefined): boolean {
  return normalizeRole(role) === "manager"
}

export function isWorker(role: string | null | undefined): boolean {
  return normalizeRole(role) === "worker"
}

export function isManagerOrAdmin(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role)
  return normalized === "admin" || normalized === "manager"
}

export function canManageCompany(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function canManageProjects(role: string | null | undefined): boolean {
  return isManagerOrAdmin(role)
}

export function canSendOffers(role: string | null | undefined): boolean {
  return isManagerOrAdmin(role)
}

export function canInviteEmployees(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function canAccessCustomers(role: string | null | undefined): boolean {
  return isManagerOrAdmin(role)
}

export function canAccessCompanySettings(role: string | null | undefined): boolean {
  return isManagerOrAdmin(role)
}

export function canManageSubscription(role: string | null | undefined): boolean {
  return isAdmin(role)
}

export function canAccessPricing(role: string | null | undefined): boolean {
  return canManageSubscription(role)
}

export function isInvitedCompanyMember(role: string | null | undefined): boolean {
  const normalized = normalizeRole(role)
  return normalized === "worker" || normalized === "manager"
}

export function hasRoleAccess(
  userRole: string | null | undefined,
  allowedRoles: string[]
): boolean {
  const normalized = normalizeRole(userRole)
  if (!normalized) return false
  return allowedRoles.some((role) => normalizeRole(role) === normalized)
}

export const DEFAULT_COMPANY_ROLE_NAMES = Object.values(ROLE_DISPLAY_NAMES)
