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

// Bunnmenyen er tre daglige destinasjoner + «Mer» — ikke et sitemap. Alt
// annet (tilbud, meldinger, kunder, dokumenter, HMS …) nås fra Mer-arket,
// som bygges av lib/app-nav og derfor aldri kan komme i utakt med sidebaren.
// Fire kolonner gir plass til ekte etiketter i stedet for 10 px avkortet tekst.
export const FULL_NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashbord", icon: "dashboard", exact: true },
  { href: "/prosjekter", label: "Prosjekter", icon: "projects", exact: false },
  { href: "/timeforing", label: "Timer", icon: "hours", exact: false },
]

// Håndverkeren starter dagen på timeføring — den ligger derfor først.
// Kjørebok og kalender flyttet til Mer-arket sammen med resten.
export const WORKER_NAV_ITEMS: NavItem[] = [
  { href: "/timeforing", label: "Timer", icon: "hours", exact: false },
  { href: "/prosjekter", label: "Prosjekter", icon: "projects", exact: false },
  { href: "/kart", label: "Kart", icon: "map", exact: false },
]
