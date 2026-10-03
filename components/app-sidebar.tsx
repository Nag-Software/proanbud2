"use client"

import * as React from "react"
import Image from "next/image"

import { NavMain } from "@/components/nav-main"
import { NavMoreMenu } from "@/components/nav-more-menu"
import { NavProjects } from "@/components/nav-projects"
import { NavUser } from "@/components/nav-user"
import { useRouter } from "next/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { LayoutDashboardIcon, UsersIcon, InboxIcon, BadgePercentIcon, Building2Icon, CarIcon, FrameIcon, PieChartIcon, MapIcon, CalendarDays, ClockIcon, FolderIcon, FilesIcon, FileTextIcon, ShieldCheckIcon, MoreHorizontalIcon } from "lucide-react"
import { useUserRole } from "@/hooks/use-user-role"
import { canInviteEmployees, canManageSubscription } from "@/lib/roles"
import { useAuth } from "@/components/auth-provider"
import { createClient } from "@/lib/supabase/client"
import { CreateProjectDrawer } from "@/app/prosjekter/create-project-dialog"
import { NativeMenuBridge } from "@/components/native-nav-bridge"
import { Skeleton } from "@/components/ui/skeleton"
import { useNotifications, type NotificationItem } from "@/hooks/use-notifications"
import { useCompanyNotifications, type CompanyNotificationItem } from "@/hooks/use-company-notifications"
import { NotificationsPopover } from "@/components/notifications-popover"
import { useOpenDeviationCount } from "@/hooks/use-open-deviation-count"
import { useActiveWorkSession } from "@/hooks/use-active-work-session"
import { SIDEBAR_PROJECTS_CHANGED_EVENT } from "@/lib/client/sidebar-projects"

type SidebarProject = {
  name: string
  url: string
  icon: React.ReactNode
}

type NavMainItem = {
  title: string
  url: string
  icon: React.ReactNode
  isActive?: boolean
  hidden?: boolean
  badge?: number
  // Mål for tutorial-veiviseren (components/onboarding/tutorial-wizard.tsx) —
  // rendres som data-tour-attributt i NavMain.
  tourId?: string
  items?: Array<{
    title: string
    url: string
    hidden?: boolean
    badge?: number
    tourId?: string
  }>
}

// This is sample data.
/**
 * De fem destinasjonene som brukes hver dag. Alt annet ligger bak «Mer» —
 * menyen skal beskrive arbeidsdagen, ikke katalogisere appen. Utvides denne
 * lista, må «Mer» bli tilsvarende kortere, ikke motsatt.
 *
 * Håndverkere har allerede et bevisst lite sett (Prosjekter, Timeføring,
 * Kart, Kjørebok, Kalender) og får derfor ingen «Mer»-inngang.
 */
const PRIMARY_NAV_TITLES = ["Dashbord", "Prosjekter", "Tilbud", "Timeføring", "Kunder"] as const

const data: {
  user: {
    name: string
    email: string
    avatar: string
  }
  navMain: NavMainItem[]
  projects: SidebarProject[]
} = {
  user: {
    name: "laster...",
    email: "laster...",
    avatar: "/avatars/shadcn.jpg",
  },
  navMain: [
    {
      title: "Dashbord",
      url: "/",
      icon: <LayoutDashboardIcon className="size-4" />,
      isActive: true,
    },
    {
      title: "Prosjekter",
      url: "/prosjekter",
      icon: <FolderIcon className="size-4" />,
    },
    {
      title: "Tilbud",
      url: "/tilbud",
      icon: <FileTextIcon className="size-4" />,
      tourId: "tilbud",
    },
    {
      // Timeføring er en modul (ikke en plan-feature) — nav-konvensjonen er at
      // modulbaserte sider (jf. Dokumenter) alltid vises; siden selv håndterer
      // manglende modul med en oppgraderingsflate.
      title: "Timeføring",
      url: "/timeforing",
      icon: <ClockIcon className="size-4" />,
      tourId: "timeforing",
    },
    {
      title: "Kunder",
      url: "/kunder",
      icon: <UsersIcon className="size-4" />,
      tourId: "kunder",
    },
    {
      title: "Kart",
      url: "/kart",
      icon: <MapIcon className="size-4" />,
    },
    {
      // Samlet kjørebok for håndverkere (egne turer på tvers av prosjekter).
      // Admin/prosjektleder har bedriftsoversikten under «Min bedrift» og får
      // derfor ikke dette punktet — se rollefilteret lenger ned.
      title: "Kjørebok",
      url: "/kjorebok",
      icon: <CarIcon className="size-4" />,
    },
    {
      title: "Kalender",
      url: "/kalender",
      icon: <CalendarDays className="size-4" />,
    },
    {
      title: "Meldinger",
      url: "/meldinger",
      icon: <InboxIcon className="size-4" />,
    },
    {
      title: "Dokumenter",
      url: "/dokumenter",
      icon: <FilesIcon className="size-4" />,
    },
    {
      title: "HMS",
      url: "/hms",
      icon: <ShieldCheckIcon className="size-4" />,
      items: [
        {
          title: "Oversikt",
          url: "/hms",
        },
        {
          title: "Avvik",
          url: "/avvik",
        },
      ],
    },
    {
      title: "Mine priser",
      url: "/mine-priser",
      icon: <BadgePercentIcon className="size-4" />,
      items: [
        {
          title: "Prisfiler",
          url: "/mine-priser/prisfiler",
        },
        {
          title: "Lagrede jobber",
          url: "/mine-priser/lagrede-jobber",
        },
        {
          title: "Timepriser",
          url: "/mine-priser/timepriser",
        },
      ]
    },
    {
      // Én samlet inngang for alt som gjelder bedriften — tidligere delt i
      // «Min bedrift» og «Innstillinger», men det var to konkurrerende
      // grupper for det samme. Integrasjoner/Betaling beholder rutene sine
      // under /innstillinger (middleware og lenker avhenger av dem).
      title: "Min bedrift",
      url: "/min-bedrift",
      icon: <Building2Icon className="size-4" />,
      tourId: "min-bedrift",
      items: [
        {
          title: "Bedriftsprofil",
          url: "/min-bedrift/bedriftsprofil",
          tourId: "bedriftsprofil",
        },
        {
          title: "Ansatte og roller",
          url: "/min-bedrift/ansatte-og-roller",
        },
        {
          title: "Integrasjoner",
          url: "/innstillinger/integrasjoner",
        },
        {
          title: "Betaling",
          url: "/innstillinger/betaling",
        },
        {
          // Godkjennings-/oversiktssiden for ledere — «Godkjenn timer» skiller
          // den fra arbeiderens egen «Timeføring» på toppnivå.
          title: "Godkjenn timer",
          url: "/min-bedrift/timeforing",
        },
        {
          title: "Kjørebok",
          url: "/min-bedrift/kjorebok",
        },
        {
          title: "KS-maler",
          url: "/min-bedrift/ks",
        },
      ]
    },
  ] satisfies NavMainItem[],
  projects: [
    {
      name: "Oppussing Storgata",
      url: "#",
      icon: (
        <FrameIcon
        />
      ),
    },
    {
      name: "Tilbygg Enebolig",
      url: "#",
      icon: (
        <PieChartIcon
        />
      ),
    },
    {
      name: "Garasje 50kvm",
      url: "#",
      icon: (
        <MapIcon
        />
      ),
    },
  ],
}


// Siste kjente «Pågående prosjekter» per bruker. Kun visning — RLS avgjør
// uansett hva spørringen får returnere.
const SIDEBAR_PROJECTS_CACHE_PREFIX = "pa_sidebar_projects_v1:"

type SidebarProjectRow = { id: string; name: string }

function toSidebarProject(row: SidebarProjectRow): SidebarProject {
  return { name: row.name, url: `/prosjekter/${row.id}`, icon: <FrameIcon /> }
}

function readSidebarProjects(userId: string): SidebarProjectRow[] | null {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_PROJECTS_CACHE_PREFIX + userId)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter(
      (row): row is SidebarProjectRow =>
        typeof row === "object" && row !== null && typeof row.id === "string" && typeof row.name === "string"
    )
  } catch {
    return null
  }
}

function writeSidebarProjects(userId: string, rows: SidebarProjectRow[]) {
  try {
    window.localStorage.setItem(
      SIDEBAR_PROJECTS_CACHE_PREFIX + userId,
      JSON.stringify(rows.map(({ id, name }) => ({ id, name })))
    )
  } catch {
    // Full/blokkert storage — cachen er kun best-effort.
  }
}

function AppSidebarHeader({
  unreadCount,
  notifications,
  offerNotifications,
  notificationsLoading,
  messagesEnabled,
  onMarkAllRead,
  onMarkThreadRead,
  onMarkNotificationRead,
  canCreateProject,
  roleLoading,
}: {
  unreadCount: number
  notifications: NotificationItem[]
  offerNotifications: CompanyNotificationItem[]
  notificationsLoading: boolean
  messagesEnabled: boolean
  onMarkAllRead: () => void
  onMarkThreadRead: (customerId: string) => void
  onMarkNotificationRead: (id: string) => void
  canCreateProject: boolean
  roleLoading: boolean
}) {
  const { state } = useSidebar()
  const router = useRouter();
  const isCollapsed = state === "collapsed"

  return (
    <SidebarHeader className="pb-0">
      <div className="flex items-center justify-between p-2 pb-0">
        <div className="relative">
          <Image
            src={isCollapsed ? "/logo/light/icon-primary.svg" : "/logo/light/logo-primary.svg"}
            alt="Proanbud"
            width={isCollapsed ? 24 : 120}
            height={isCollapsed ? 24 : 40}
            className="cursor-pointer"
            onClick={() => router.push("/")}
          />
          {isCollapsed && unreadCount > 0 && (
            <span
              className="pointer-events-none absolute -right-1 -top-1 size-2 rounded-full bg-primary ring-2 ring-sidebar"
              aria-label={`${unreadCount} uleste varsler`}
            />
          )}
        </div>
        {!isCollapsed && (
          <div className="shrink-0">
            <NotificationsPopover
              notifications={notifications}
              offerNotifications={offerNotifications}
              unreadCount={unreadCount}
              loading={notificationsLoading}
              messagesEnabled={messagesEnabled}
              onMarkAllRead={onMarkAllRead}
              onMarkThreadRead={onMarkThreadRead}
              onMarkNotificationRead={onMarkNotificationRead}
            />
          </div>
        )}
      </div>
      {/* Workers kan ikke opprette prosjekter — vis aldri knappen for dem.
          Rollen lastes async, så vi holder plassen med en skeleton til den er
          kjent i stedet for å la knappen blinke inn og ut. */}
      {roleLoading ? (
        <Skeleton className="mt-1 h-8 w-full" />
      ) : canCreateProject ? (
        // data-tour: mål for tutorial-veiviserens «Opprett et prosjekt»-steg.
        <div data-tour="nytt-prosjekt">
          <CreateProjectDrawer
            variant="outline"
            size="sm"
            className="w-full mt-1 hover:shadow-sm"
            label={isCollapsed ? "" : "Nytt prosjekt"}
            showIcon
          />
        </div>
      ) : null}
    </SidebarHeader>
  )
}

/**
 * «Mer»-raden i sidebaren. Ser ut som et vanlig menypunkt, men åpner
 * grupperte snarveier (components/nav-more-menu) i stedet for å navigere.
 */
function NavMoreEntry({ badge, primaryHrefs }: { badge: number; primaryHrefs: string[] }) {
  const [open, setOpen] = React.useState(false)

  return (
    <SidebarGroup className="pt-0">
      <SidebarMenu className="gap-0.5">
        <SidebarMenuItem>
          <SidebarMenuButton
            tooltip="Mer"
            onClick={() => setOpen(true)}
            className="text-[14px] font-medium"
          >
            <MoreHorizontalIcon className="size-4" />
            <span>Mer</span>
          </SidebarMenuButton>
          {badge > 0 && (
            <SidebarMenuBadge className="rounded-full bg-primary text-[10px] text-primary-foreground">
              {badge > 99 ? "99+" : badge}
            </SidebarMenuBadge>
          )}
        </SidebarMenuItem>
      </SidebarMenu>
      <NavMoreMenu open={open} onOpenChange={setOpen} primaryHrefs={primaryHrefs} />
    </SidebarGroup>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  // isWorker/roleKnown er cache-seedet (per-bruker localStorage i
  // useUserRole), så gjenbesøk får riktig menysett fra første klientframe i
  // stedet for at admin-settet blinker før worker-allowlisten slår inn.
  const { role, hasFeature, loadingRole, isWorker, roleKnown } = useUserRole();
  const { user } = useAuth();
  const {
    notifications,
    unreadCount,
    loading: notificationsLoading,
    markAllRead,
    markThreadRead,
  } = useNotifications({ enabled: loadingRole || hasFeature("meldinger") });
  // Tilbudsvarsler (kunden åpnet / e-posten kom ikke frem) gjelder alle planer,
  // men ikke arbeidere — de jobber ikke med tilbud.
  const {
    notifications: offerNotifications,
    unreadCount: offerUnreadCount,
    loading: offerNotificationsLoading,
    markRead: markOfferNotificationRead,
    markAllRead: markAllOfferNotificationsRead,
  } = useCompanyNotifications({ enabled: roleKnown && !isWorker });
  const openDeviationCount = useOpenDeviationCount();
  const { hasActiveSession } = useActiveWorkSession();
  const [activeProjects, setActiveProjects] = React.useState<SidebarProject[]>([]);
  const canManageBilling = canManageSubscription(role);
  // While the plan context is still loading, treat features as available so
  // Proff items do not flicker out and then back in (matches how the rest of
  // the file defers plan-dependent UI until the context resolves).
  const featureEnabled = (feature: Parameters<typeof hasFeature>[0]) =>
    loadingRole || hasFeature(feature);
  // Suppress the messages badge entirely when the plan lacks Meldinger.
  const visibleUnreadCount = featureEnabled("meldinger") ? unreadCount : 0;
  // Bjella teller begge deler; «Meldinger» i menyen teller fortsatt bare meldinger.
  const bellUnreadCount = visibleUnreadCount + offerUnreadCount;
  const markAllNotificationsRead = React.useCallback(() => {
    void markAllRead();
    void markAllOfferNotificationsRead();
  }, [markAllRead, markAllOfferNotificationsRead]);

  // Prosjektlista males fra forrige besøk med en gang, og hentes én gang per
  // økt. Nøklet på bruker-id (ikke user-objektet), så den ikke hentes på nytt
  // når sesjonen fornyes.
  const userId: string | null = user?.id ?? null
  React.useEffect(() => {
    if (!userId) return
    const cached = readSidebarProjects(userId)
    if (cached) setActiveProjects(cached.map(toSidebarProject))
  }, [userId])

  React.useEffect(() => {
    if (!userId || role === null) return
    let cancelled = false

    async function fetchProjects(id: string) {
      const { data: projectsData, error } = await createClient()
        .from("projects")
        .select("id, name")
        .in("status", ["planning", "active"])
        .order("updated_at", { ascending: false })
        .limit(5);

      if (cancelled || !projectsData || error) return
      setActiveProjects(projectsData.map(toSidebarProject));
      writeSidebarProjects(id, projectsData)
    }

    void fetchProjects(userId);
    // Nytt, arkivert eller omdøpt prosjekt: hent lista på nytt.
    const onChanged = () => void fetchProjects(userId)
    window.addEventListener(SIDEBAR_PROJECTS_CHANGED_EVENT, onChanged)
    return () => {
      cancelled = true
      window.removeEventListener(SIDEBAR_PROJECTS_CHANGED_EVENT, onChanged)
    }
  }, [userId, role]);

  const filteredNavMain = data.navMain
    .map((item) => {
      if (item.title === "Meldinger" && visibleUnreadCount > 0) {
        return { ...item, badge: visibleUnreadCount };
      }
      // Pulserende grønn dot på Timeføring-ikonet når brukeren er stemplet
      // inn — samme visuelle språk som unread-dotten på den kollapsede logoen.
      if (item.title === "Timeføring" && hasActiveSession) {
        return {
          ...item,
          icon: (
            <span className="relative flex size-4 shrink-0 items-center justify-center">
              <ClockIcon className="size-4" />
              <span
                aria-hidden
                className="absolute -right-1 -top-1 size-2 animate-pulse rounded-full bg-emerald-500 ring-2 ring-sidebar"
              />
              <span className="sr-only">Stemplet inn</span>
            </span>
          ),
        };
      }
      if (item.title === "HMS" && item.items) {
        return {
          ...item,
          // Hide the Avvik subitem when the plan lacks the Avvik feature.
          items: item.items
            .filter((subItem) => subItem.title !== "Avvik" || featureEnabled("avvik"))
            .map((subItem) =>
              subItem.title === "Avvik" && openDeviationCount > 0
                ? { ...subItem, badge: openDeviationCount }
                : subItem
            ),
        }
      }
      if (item.title === "Min bedrift" && item.items) {
        return {
          ...item,
          items: item.items.filter((subItem) => {
            // KS-maler er en Proff-feature — skjul når planen mangler den.
            if (subItem.title === "KS-maler") return featureEnabled("ks")
            // Betaling kan bare administreres av admin.
            if (subItem.title === "Betaling") return canManageBilling
            // Ansatte og roller slipper kun inn admin (layouten redirecter
            // alle andre) — skjul punktet så prosjektledere ikke ser en død
            // lenke. Integrasjoner tillater admin + prosjektleder og vises
            // derfor for begge.
            if (subItem.title === "Ansatte og roller") return canInviteEmployees(role)
            return true
          }),
        };
      }
      return item;
    })
    .filter((item) => {
    if (item.hidden) return false;
    // Proff-only features are hidden when the plan lacks them (in addition to
    // the role filtering below — a feature hide is additive).
    if (item.title === "Kalender" && !featureEnabled("kalender")) return false;
    if (item.title === "Meldinger" && !featureEnabled("meldinger")) return false;
    if (item.title === "HMS" && !featureEnabled("hms")) return false;
    // Workers have a deliberately small surface: Projects, Timeføring, Kart
    // (read-only locator), Kjørebok (own trips) and Calendar.
    if (isWorker) {
      return ["Prosjekter", "Timeføring", "Kart", "Kjørebok", "Kalender"].includes(item.title);
    }
    // Kjørebok-punktet er worker-varianten; admin/prosjektleder når kjørebok
    // via «Min bedrift» og skal ikke se en duplisert inngang.
    if (item.title === "Kjørebok") return false;
    return true;
  });

  // Fem daglige punkter i menyen; resten (med badges intakt) bak «Mer».
  const primaryNav = isWorker
    ? filteredNavMain
    : filteredNavMain.filter((item) =>
        (PRIMARY_NAV_TITLES as readonly string[]).includes(item.title)
      )
  const secondaryNav = isWorker
    ? []
    : filteredNavMain.filter(
        (item) => !(PRIMARY_NAV_TITLES as readonly string[]).includes(item.title)
      )
  // Uleste meldinger og åpne avvik havner bak «Mer» — da må tallet flyttes med,
  // ellers forsvinner varselet ut av syne.
  const moreBadge = secondaryNav.reduce(
    (sum, item) =>
      sum +
      (item.badge ?? 0) +
      (item.items?.reduce((subSum, subItem) => subSum + (subItem.badge ?? 0), 0) ?? 0),
    0
  )
  const primaryHrefs = primaryNav.map((item) => item.url)

  return (
    <Sidebar collapsible="icon" {...props}>
      {/* Appens «Mer»-ark viser denne menyen — send den over broen så de to
          aldri kan drifte fra hverandre. Rendrer ingenting. */}
      <NativeMenuBridge items={filteredNavMain} />
      <AppSidebarHeader
        unreadCount={bellUnreadCount}
        notifications={notifications}
        offerNotifications={offerNotifications}
        notificationsLoading={notificationsLoading || offerNotificationsLoading}
        messagesEnabled={featureEnabled("meldinger")}
        onMarkAllRead={markAllNotificationsRead}
        onMarkThreadRead={markThreadRead}
        onMarkNotificationRead={markOfferNotificationRead}
        canCreateProject={!isWorker}
        roleLoading={!roleKnown}
      />
      <SidebarContent>
        {roleKnown ? (
          <>
            <NavMain items={primaryNav} />
            {secondaryNav.length > 0 && (
              <NavMoreEntry badge={moreBadge} primaryHrefs={primaryHrefs} />
            )}
          </>
        ) : (
          // Rollen er ukjent (aller første besøk uten cache) — vis nøytrale
          // skeleton-rader i stedet for å blinke hele admin-menyen for en
          // håndverker. Samme mønster som CreateProjectDrawer-skeletonen over.
          <SidebarGroup>
            <SidebarMenu className="gap-0.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <SidebarMenuItem key={i}>
                  <SidebarMenuSkeleton showIcon />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        )}
        <NavProjects projects={activeProjects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
