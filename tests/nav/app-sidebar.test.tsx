// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import type { FeatureKey } from "@/lib/billing/plans"

// Rolle, plan og åpne avvik styres per test — alt annet rundt sidebaren er
// stubbet bort, så testen bare ser menyen.
const state = vi.hoisted(() => ({
  role: "admin" as string,
  features: new Set<string>(),
  openDeviations: 0,
  nativeMenu: [] as Array<{ url: string; hidden?: boolean; items?: Array<{ url: string; hidden?: boolean }> }>,
}))

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, prefetch: () => {} }),
}))
vi.mock("next/image", () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}))
vi.mock("@/hooks/use-user-role", () => ({
  useUserRole: () => ({
    role: state.role,
    isWorker: state.role === "worker",
    roleKnown: true,
    loadingRole: false,
    hasFeature: (feature: FeatureKey) => state.features.has(feature),
  }),
}))
vi.mock("@/lib/kalkyle/flag", () => ({ KALKYLE_ENABLED: true }))
vi.mock("@/components/auth-provider", () => ({ useAuth: () => ({ user: null }) }))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }))
vi.mock("@/app/prosjekter/create-project-dialog", () => ({ CreateProjectDrawer: () => null }))
vi.mock("@/components/nav-user", () => ({ NavUser: () => null }))
vi.mock("@/components/nav-projects", () => ({ NavProjects: () => null }))
vi.mock("@/components/notifications-popover", () => ({ NotificationsPopover: () => null }))
vi.mock("@/hooks/use-notifications", () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    loading: false,
    markAllRead: async () => {},
    markThreadRead: async () => {},
  }),
}))
vi.mock("@/hooks/use-company-notifications", () => ({
  useCompanyNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    loading: false,
    markRead: async () => {},
    markAllRead: async () => {},
  }),
}))
vi.mock("@/hooks/use-open-deviation-count", () => ({
  useOpenDeviationCount: () => state.openDeviations,
}))
vi.mock("@/hooks/use-active-work-session", () => ({
  useActiveWorkSession: () => ({ hasActiveSession: false }),
}))
vi.mock("@/components/native-nav-bridge", () => ({
  NativeMenuBridge: ({ items }: { items: typeof state.nativeMenu }) => {
    state.nativeMenu = items
    return null
  },
}))

import { AppSidebar, PRIMARY_NAV_TITLES } from "@/components/app-sidebar"
import { SidebarProvider } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"

const PROFF = ["hms", "ks", "avvik", "kalender", "project_tasks", "meldinger", "meldinger_ki", "integrasjoner"]

// Alt sidebaren lenket til før omleggingen (direkte eller som underpunkt).
// Ingen av disse sidene skal bli utilgjengelige.
const PREVIOUS_SIDEBAR_HREFS = [
  "/",
  "/prosjekter",
  "/tilbud",
  "/timeforing",
  "/kunder",
  "/kart",
  "/kalender",
  "/meldinger",
  "/dokumenter",
  "/hms",
  "/avvik",
  "/mine-priser/prisfiler",
  "/mine-priser/lagrede-jobber",
  "/mine-priser/kalkylemaler",
  "/mine-priser/timepriser",
  "/min-bedrift/bedriftsprofil",
  "/min-bedrift/ansatte-og-roller",
  "/innstillinger/integrasjoner",
  "/innstillinger/betaling",
  "/min-bedrift/timeforing",
  "/min-bedrift/kjorebok",
  "/min-bedrift/ks",
]

beforeEach(() => {
  // «Mer» er en Radix-dialog som måler seg med ResizeObserver; jsdom har den ikke.
  // Uten denne åpnet dialogen seg bare noen ganger, og testene feilet tilfeldig.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  state.role = "admin"
  state.features = new Set(PROFF)
  state.openDeviations = 0
  state.nativeMenu = []
})

afterEach(() => {
  cleanup()
})

function renderSidebar() {
  render(
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>
    </TooltipProvider>
  )
}

/** Lenkene i selve sidemenyen, i rekkefølge. */
function sidebarLinks() {
  return screen.getAllByRole("link").map((link) => ({
    title: link.textContent?.trim(),
    href: link.getAttribute("href"),
  }))
}

/** Åpner «Mer» og returnerer lenkene i arket. */
async function moreLinks() {
  await userEvent.click(screen.getByRole("button", { name: "Mer" }))
  const dialog = await screen.findByRole("dialog")
  return within(dialog)
    .getAllByRole("link")
    .map((link) => ({ title: link.textContent?.trim(), href: link.getAttribute("href") }))
}

describe("Sidemenyen", () => {
  it("har de sju daglige punktene i fast rekkefølge, og så «Mer»", () => {
    renderSidebar()
    expect(PRIMARY_NAV_TITLES).toEqual(["Dashbord", "Prosjekter", "Kalender", "Kunder", "Timeføring", "HMS", "Kart"])
    expect(sidebarLinks()).toEqual([
      { title: "Dashbord", href: "/" },
      { title: "Prosjekter", href: "/prosjekter" },
      { title: "Kalender", href: "/kalender" },
      { title: "Kunder", href: "/kunder" },
      { title: "Timeføring", href: "/timeforing" },
      { title: "HMS", href: "/hms" },
      { title: "Kart", href: "/kart" },
    ])
    expect(screen.getByRole("button", { name: "Mer" })).toBeTruthy()
  })

  it("når alle tidligere sider via hovedmenyen eller «Mer» (admin, Proff)", async () => {
    renderSidebar()
    const primary = sidebarLinks()
    const more = await moreLinks()

    const reachable = new Set([...primary, ...more].map((link) => link.href))
    const missing = PREVIOUS_SIDEBAR_HREFS.filter((href) => !reachable.has(href))
    expect(missing).toEqual([])

    // Det som står i hovedmenyen, gjentas ikke i «Mer».
    const primaryHrefs = new Set(primary.map((link) => link.href))
    expect(more.filter((link) => primaryHrefs.has(link.href))).toEqual([])
    expect(more.map((link) => link.title)).toEqual(
      expect.arrayContaining(["Tilbud", "Meldinger", "Dokumenter", "Avvik", "Prisfiler", "Kalkylemaler", "Betaling"])
    )
  })

  it("sender fortsatt alle sidene til appens native «Mer»-ark", () => {
    renderSidebar()
    const hrefs = new Set(
      state.nativeMenu
        .filter((item) => !item.hidden)
        .flatMap((item) =>
          item.items?.length ? item.items.filter((sub) => !sub.hidden).map((sub) => sub.url) : [item.url]
        )
    )
    expect(PREVIOUS_SIDEBAR_HREFS.filter((href) => !hrefs.has(href))).toEqual([])
  })

  it("skjuler bare admin-sidene for prosjektleder", async () => {
    state.role = "manager"
    renderSidebar()
    const reachable = new Set([...sidebarLinks(), ...(await moreLinks())].map((link) => link.href))
    const adminOnly = ["/min-bedrift/ansatte-og-roller", "/innstillinger/betaling"]

    expect(PREVIOUS_SIDEBAR_HREFS.filter((href) => !adminOnly.includes(href) && !reachable.has(href))).toEqual([])
    expect(adminOnly.filter((href) => reachable.has(href))).toEqual([])
  })

  it("lar Mini-planen se Kalender, men ikke HMS, Avvik, Meldinger eller KS-maler", async () => {
    state.features = new Set(["kalender"])
    renderSidebar()
    expect(sidebarLinks().map((link) => link.title)).toEqual([
      "Dashbord",
      "Prosjekter",
      "Kalender",
      "Kunder",
      "Timeføring",
      "Kart",
    ])
    const more = (await moreLinks()).map((link) => link.href)
    expect(more).toContain("/tilbud")
    expect(more).not.toContain("/hms")
    expect(more).not.toContain("/avvik")
    expect(more).not.toContain("/meldinger")
    expect(more).not.toContain("/min-bedrift/ks")
  })

  it("gir håndverkeren det lille settet med Kjørebok, og ingen «Mer»", () => {
    state.role = "worker"
    renderSidebar()
    expect(sidebarLinks()).toEqual([
      { title: "Prosjekter", href: "/prosjekter" },
      { title: "Kalender", href: "/kalender" },
      { title: "Timeføring", href: "/timeforing" },
      { title: "Kart", href: "/kart" },
      { title: "Kjørebok", href: "/kjorebok" },
    ])
    expect(screen.queryByRole("button", { name: "Mer" })).toBeNull()
  })

  it("viser åpne avvik på HMS, siden Avvik selv ligger bak «Mer»", () => {
    state.openDeviations = 4
    renderSidebar()
    const hmsItem = screen.getByRole("link", { name: "HMS" }).closest("li")
    expect(hmsItem?.textContent).toContain("4")
  })
})
