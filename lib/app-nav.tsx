import type { LucideIcon } from "lucide-react"
import {
  BadgePercentIcon,
  Building2Icon,
  CalendarDays,
  CarIcon,
  ClipboardCheckIcon,
  ClockIcon,
  CreditCardIcon,
  FilesIcon,
  FileTextIcon,
  FolderIcon,
  InboxIcon,
  LayoutDashboardIcon,
  MapIcon,
  PlugIcon,
  ShieldCheckIcon,
  UsersIcon,
} from "lucide-react"

import type { FeatureKey } from "@/lib/billing/plans"
import { canInviteEmployees, canManageSubscription } from "@/lib/roles"

/**
 * Delt, rollebevisst liste over appens destinasjoner — brukes av det globale
 * søket (⌘K) og mobilmenyen, med samme regler som sidebaren:
 * - Workers har en bevisst liten flate (Prosjekter, Timeføring, Kart,
 *   Kjørebok, Kalender).
 * - Admin/prosjektleder når kjørebok via «Min bedrift» og har ikke
 *   toppnivå-punktet.
 * - Plan-gatede sider skjules når featuren mangler; mens plan-konteksten
 *   laster vises de (samme anti-blink-regel som sidebaren).
 *
 * Endres sidebarens regler (components/app-sidebar.tsx), må denne holdes i
 * takt — den er kilden for søk og mobilmeny, ikke for sidebaren.
 */

export type AppNavGroup = "arbeid" | "priser" | "bedrift"

export type AppNavEntry = {
  title: string
  href: string
  icon: LucideIcon
  /** Ekstra søkeord (lowercase) utover tittelen — kun brukt av søket. */
  keywords?: string
  group: AppNavGroup
  /** Synlig for workers (standard: nei). */
  workerVisible?: boolean
  /** Kun for workers (admin/PL har annen inngang). */
  workerOnly?: boolean
  feature?: FeatureKey
  /** Krever admin (Betaling) / admin-invitasjonsrett (Ansatte og roller). */
  requires?: "manage_billing" | "invite_employees"
  /** Paraplyoppføring: vises i søket, men ikke i mobilmenyen (undersidene dekker den). */
  menuHidden?: boolean
}

export const APP_NAV_GROUP_LABELS: Record<AppNavGroup, string> = {
  arbeid: "Daglig arbeid",
  priser: "Mine priser",
  bedrift: "Min bedrift",
}

export const APP_NAV_ENTRIES: AppNavEntry[] = [
  // ── Daglig arbeid ─────────────────────────────────────────────────────
  { title: "Dashbord", href: "/", icon: LayoutDashboardIcon, keywords: "hjem oversikt forside", group: "arbeid" },
  { title: "Prosjekter", href: "/prosjekter", icon: FolderIcon, keywords: "jobber byggeplass", group: "arbeid", workerVisible: true },
  { title: "Tilbud", href: "/tilbud", icon: FileTextIcon, keywords: "anbud pristilbud kalkyle", group: "arbeid" },
  { title: "Timeføring", href: "/timeforing", icon: ClockIcon, keywords: "timer stemple inn ut arbeidstid", group: "arbeid", workerVisible: true },
  { title: "Kunder", href: "/kunder", icon: UsersIcon, keywords: "kontakter byggherre", group: "arbeid" },
  { title: "Kart", href: "/kart", icon: MapIcon, keywords: "prosjektkart mannskap", group: "arbeid", workerVisible: true },
  { title: "Kjørebok", href: "/kjorebok", icon: CarIcon, keywords: "turer kilometer km", group: "arbeid", workerVisible: true, workerOnly: true },
  { title: "Kalender", href: "/kalender", icon: CalendarDays, keywords: "avtaler møter frister", group: "arbeid", workerVisible: true, feature: "kalender" },
  { title: "Meldinger", href: "/meldinger", icon: InboxIcon, keywords: "sms epost dialog", group: "arbeid", feature: "meldinger" },
  { title: "Dokumenter", href: "/dokumenter", icon: FilesIcon, keywords: "filer mapper vedlegg", group: "arbeid" },
  { title: "HMS", href: "/hms", icon: ShieldCheckIcon, keywords: "sikkerhet sja vernerunde", group: "arbeid", feature: "hms" },
  { title: "Avvik", href: "/avvik", icon: ShieldCheckIcon, keywords: "ruh rapport uønsket hendelse", group: "arbeid", feature: "avvik" },

  // ── Mine priser ───────────────────────────────────────────────────────
  { title: "Mine priser", href: "/mine-priser", icon: BadgePercentIcon, keywords: "prisliste påslag", group: "priser", menuHidden: true },
  { title: "Prisfiler", href: "/mine-priser/prisfiler", icon: BadgePercentIcon, keywords: "prisliste leverandør grossist efo nelfo import", group: "priser" },
  { title: "Lagrede jobber", href: "/mine-priser/lagrede-jobber", icon: BadgePercentIcon, keywords: "maler standardjobber fastpris", group: "priser" },
  { title: "Timepriser", href: "/mine-priser/timepriser", icon: ClockIcon, keywords: "timesats timelønn", group: "priser" },

  // ── Min bedrift ───────────────────────────────────────────────────────
  { title: "Min bedrift", href: "/min-bedrift", icon: Building2Icon, keywords: "firma innstillinger", group: "bedrift", menuHidden: true },
  { title: "Bedriftsprofil", href: "/min-bedrift/bedriftsprofil", icon: Building2Icon, keywords: "logo orgnummer firmainfo", group: "bedrift" },
  { title: "Ansatte og roller", href: "/min-bedrift/ansatte-og-roller", icon: UsersIcon, keywords: "inviter bruker tilgang", group: "bedrift", requires: "invite_employees" },
  { title: "Regnskap", href: "/min-bedrift/regnskap", icon: PlugIcon, keywords: "fiken tripletex faktura synk regnskapssystem", group: "bedrift" },
  { title: "Integrasjoner", href: "/innstillinger/integrasjoner", icon: PlugIcon, keywords: "tripletex fiken regnskap kobling", group: "bedrift" },
  { title: "Betaling", href: "/innstillinger/betaling", icon: CreditCardIcon, keywords: "abonnement plan fakturering oppgrader", group: "bedrift", requires: "manage_billing" },
  { title: "Godkjenn timer", href: "/min-bedrift/timeforing", icon: ClockIcon, keywords: "attestere timelister", group: "bedrift" },
  { title: "Kjørebok (bedrift)", href: "/min-bedrift/kjorebok", icon: CarIcon, keywords: "turer ansatte reiseregning", group: "bedrift" },
  { title: "KS-maler", href: "/min-bedrift/ks", icon: ClipboardCheckIcon, keywords: "kvalitetssikring sjekklister", group: "bedrift", feature: "ks" },
]

export type AppNavContext = {
  role: string | null
  isWorker: boolean
  /** Mens plan-konteksten laster vises plan-gatede punkter (anti-blink). */
  loadingRole: boolean
  hasFeature: (feature: FeatureKey) => boolean
}

export function filterAppNav(context: AppNavContext, entries: AppNavEntry[] = APP_NAV_ENTRIES): AppNavEntry[] {
  const { role, isWorker, loadingRole, hasFeature } = context
  return entries.filter((entry) => {
    if (isWorker && !entry.workerVisible) return false
    if (!isWorker && entry.workerOnly) return false
    if (entry.feature && !loadingRole && !hasFeature(entry.feature)) return false
    if (entry.requires === "manage_billing" && !canManageSubscription(role)) return false
    if (entry.requires === "invite_employees" && !canInviteEmployees(role)) return false
    return true
  })
}
