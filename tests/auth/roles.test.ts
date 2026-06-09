import { describe, expect, it } from "vitest"

import {
  canAccessCustomers,
  canInviteEmployees,
  canManageProjects,
  canSendOffers,
  getRoleDisplayName,
  hasRoleAccess,
  isWorker,
  normalizeRole,
} from "../../lib/roles"

describe("roles", () => {
  it("normalizes Norwegian and English role names", () => {
    expect(normalizeRole("Administrator")).toBe("admin")
    expect(normalizeRole("Prosjektleder")).toBe("manager")
    expect(normalizeRole("Håndverker")).toBe("worker")
    expect(normalizeRole("admin")).toBe("admin")
    expect(normalizeRole("manager")).toBe("manager")
    expect(normalizeRole("worker")).toBe("worker")
  })

  it("maps canonical roles to display names", () => {
    expect(getRoleDisplayName("admin")).toBe("Administrator")
    expect(getRoleDisplayName("manager")).toBe("Prosjektleder")
    expect(getRoleDisplayName("worker")).toBe("Håndverker")
  })

  it("allows admin full access checks", () => {
    expect(canInviteEmployees("Administrator")).toBe(true)
    expect(canManageProjects("Administrator")).toBe(true)
    expect(canSendOffers("Administrator")).toBe(true)
    expect(canAccessCustomers("Administrator")).toBe(true)
  })

  it("allows manager project and offer access but not employee invites", () => {
    expect(canManageProjects("Prosjektleder")).toBe(true)
    expect(canSendOffers("Prosjektleder")).toBe(true)
    expect(canAccessCustomers("Prosjektleder")).toBe(true)
    expect(canInviteEmployees("Prosjektleder")).toBe(false)
  })

  it("restricts worker to project participation features", () => {
    expect(isWorker("Håndverker")).toBe(true)
    expect(canManageProjects("Håndverker")).toBe(false)
    expect(canSendOffers("Håndverker")).toBe(false)
    expect(canAccessCustomers("Håndverker")).toBe(false)
    expect(canInviteEmployees("Håndverker")).toBe(false)
  })

  it("checks route access with mixed role aliases", () => {
    expect(hasRoleAccess("admin", ["Administrator", "Prosjektleder"])).toBe(true)
    expect(hasRoleAccess("manager", ["Administrator", "Prosjektleder"])).toBe(true)
    expect(hasRoleAccess("worker", ["Administrator", "Prosjektleder"])).toBe(false)
    expect(hasRoleAccess("worker", ["admin", "manager", "worker"])).toBe(true)
  })
})

describe("invitation route safeguards", () => {
  it("uses admin client and role checks for invitations", async () => {
    const { readFileSync } = await import("fs")
    const { resolve } = await import("path")
    const route = readFileSync(resolve(__dirname, "../../app/api/invitations/route.ts"), "utf-8")

    expect(route).toContain("createAdminClient")
    expect(route).toContain("canInviteEmployees")
    expect(route).toContain("ensureCompanyRoles")
  })
})
