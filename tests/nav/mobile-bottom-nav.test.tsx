import { renderToString } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

// Rollen styres per test — alt annet i baren er statisk.
const roleState = vi.hoisted(() => ({ isWorker: false }))

vi.mock("next/navigation", () => ({
  usePathname: () => "/prosjekter",
  useRouter: () => ({ push: () => {}, prefetch: () => {} }),
}))
vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({
    isWorker: roleState.isWorker,
    roleKnown: true,
    loadingRole: false,
    hasFeature: () => true,
  }),
}))
vi.mock("@/hooks/use-unread-messages", () => ({ useUnreadMessages: () => 3 }))
vi.mock("@/hooks/use-is-native-app", () => ({ useIsNativeApp: () => false }))
vi.mock("@/hooks/use-active-work-session", () => ({
  useActiveWorkSession: () => ({ hasActiveSession: false }),
}))
vi.mock("@/components/nav-more-menu", () => ({ NavMoreMenu: () => null }))
vi.mock("@/components/quick-action-sheet", () => ({ QuickActionSheet: () => null }))

import { MobileBottomNav } from "../../components/mobile-bottom-nav"
import { hasMoreMenu, WORKER_NAV_ITEMS } from "../../lib/nav-items"

describe("Bunnmenyen for håndverkere", () => {
  it("har Kjørebok i baren og ingen «Mer»", () => {
    roleState.isWorker = true
    const html = renderToString(<MobileBottomNav />)
    expect(html).toContain('href="/kjorebok"')
    expect(html).toContain(">Kjørebok<")
    expect(html).not.toContain('aria-label="Mer"')
    expect(WORKER_NAV_ITEMS.map((item) => item.href)).toEqual([
      "/timeforing",
      "/prosjekter",
      "/kart",
      "/kjorebok",
    ])
    expect(hasMoreMenu(true)).toBe(false)
  })

  it("beholder «Mer» for admin og prosjektleder", () => {
    roleState.isWorker = false
    const html = renderToString(<MobileBottomNav />)
    expect(html).toContain('aria-label="Mer"')
    expect(html).not.toContain('href="/kjorebok"')
    expect(hasMoreMenu(false)).toBe(true)
  })
})
