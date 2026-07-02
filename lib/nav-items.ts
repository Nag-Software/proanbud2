import type { FeatureKey } from "@/lib/billing/plans"

/**
 * Bottom-nav destinations — single source of truth shared by the web pill
 * (mobile-bottom-nav) and the native-app bridge (native-nav-bridge), so the
 * native tab bar always mirrors the web's role/plan rules.
 *
 * `icon` is a stable, serializable key: the web maps it to lucide, the native
 * app maps it to its own icon set. Renaming a key is a breaking change for
 * the app — add new keys instead.
 */
export type NavIconKey =
  | "dashboard"
  | "projects"
  | "offers"
  | "hours"
  | "messages"
  | "map"
  | "trips"
  | "calendar"

export type NavItem = {
  href: string
  label: string
  icon: NavIconKey
  exact: boolean
  /** Hidden when the company's plan lacks the feature. */
  feature?: FeatureKey
}

// Bunn-naven speiler de daglige kjerneoppgavene — HMS nås via sidebaren/Meny.
// (/tilbud gates ikke — tilbud er kjernefunksjon i alle planer.)
export const FULL_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashbord", icon: "dashboard", exact: true },
  { href: "/prosjekter", label: "Prosjekter", icon: "projects", exact: false },
  { href: "/tilbud", label: "Tilbud", icon: "offers", exact: false },
  { href: "/timeforing", label: "Timer", icon: "hours", exact: false },
  { href: "/meldinger", label: "Meldinger", icon: "messages", exact: false, feature: "meldinger" },
]

// Workers only have Projects, Timer, Kart (read-only locator), Kjørebok
// (own trips across projects) + Calendar.
export const WORKER_NAV_ITEMS: NavItem[] = [
  { href: "/prosjekter", label: "Prosjekter", icon: "projects", exact: false },
  { href: "/timeforing", label: "Timer", icon: "hours", exact: false },
  { href: "/kart", label: "Kart", icon: "map", exact: false },
  { href: "/kjorebok", label: "Kjørebok", icon: "trips", exact: false },
  { href: "/kalender", label: "Kalender", icon: "calendar", exact: false, feature: "kalender" },
]
