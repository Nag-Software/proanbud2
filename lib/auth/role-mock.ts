/**
 * Development-only role override for testing RBAC.
 *
 * Append `?mock=worker`, `?mock=pm`, or `?mock=admin` to any URL to view the app
 * as that role. The choice is persisted in a cookie and applied to both
 * server-side guards (`getCurrentUserRole`/`checkRoleAccess`) and client-side
 * role hooks (`useUserRole`). Use `?mock=clear` (or off/reset/real) to stop.
 *
 * This only changes role-based *UI gating and redirects* — the real user's data
 * is still scoped by Supabase RLS. It is disabled in production unless
 * NEXT_PUBLIC_ENABLE_ROLE_MOCK="true" is set.
 */
import type { CanonicalRole } from "@/lib/roles"

export const MOCK_ROLE_COOKIE = "pa_mock_role"

export function isRoleMockEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_ENABLE_ROLE_MOCK === "true"
  )
}

const MOCK_ROLE_ALIASES: Record<string, CanonicalRole> = {
  worker: "worker",
  handverker: "worker",
  håndverker: "worker",
  pm: "manager",
  manager: "manager",
  prosjektleder: "manager",
  leder: "manager",
  admin: "admin",
  administrator: "admin",
}

const CLEAR_KEYWORDS = new Set(["clear", "off", "reset", "none", "real", ""])

export type MockRoleResolution =
  | { kind: "set"; role: CanonicalRole }
  | { kind: "clear" }
  | { kind: "ignore" }

/** Interpret a raw `?mock=` query value. */
export function resolveMockRoleParam(value: string | null | undefined): MockRoleResolution {
  if (value == null) return { kind: "ignore" }
  const key = value.trim().toLowerCase()
  if (CLEAR_KEYWORDS.has(key)) return { kind: "clear" }
  const role = MOCK_ROLE_ALIASES[key]
  return role ? { kind: "set", role } : { kind: "ignore" }
}

/** Validate a stored cookie value into a canonical role (or null). */
export function canonicalMockRole(value: string | null | undefined): CanonicalRole | null {
  if (!value) return null
  return MOCK_ROLE_ALIASES[value.trim().toLowerCase()] ?? null
}

/** Read the active mock role from `document.cookie` (client only). */
export function readMockRoleFromDocument(): CanonicalRole | null {
  if (typeof document === "undefined") return null
  if (!isRoleMockEnabled()) return null
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${MOCK_ROLE_COOKIE}=`))
  if (!match) return null
  return canonicalMockRole(decodeURIComponent(match.split("=")[1] ?? ""))
}
