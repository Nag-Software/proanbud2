"use client"

import * as React from "react"
import Image from "next/image"

import { NavMain } from "@/components/nav-main"
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
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { LayoutDashboardIcon, UsersIcon, InboxIcon, BadgePercentIcon, Building2Icon, CarIcon, FrameIcon, PieChartIcon, MapIcon, CalendarDays, ClockIcon, FolderIcon, FilesIcon, FileTextIcon, ShieldCheckIcon } from "lucide-react"
import { useUserRole } from "@/hooks/use-user-role"
import { canInviteEmployees, canManageSubscription } from "@/lib/roles"
import { useAuth } from "@/components/auth-provider"
import { createClient } from "@/lib/supabase/client"
import { CreateProjectDrawer } from "@/app/prosjekter/create-project-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { useNotifications, type NotificationItem } from "@/hooks/use-notifications"
import { NotificationsPopover } from "@/components/notifications-popover"
import { useOpenDeviationCount } from "@/hooks/use-open-deviation-count"
import { useActiveWorkSession } from "@/hooks/use-active-work-session"

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
  items?: Array<{
    title: string
    url: string
    hidden?: boolean
    badge?: number
  }>
}

// This is sample data.
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
    },
    {
      // Timeføring er en modul (ikke en plan-feature) — nav-konvensjonen er at
      // modulbaserte sider (jf. Dokumenter) alltid vises; siden selv håndterer
      // manglende modul med en oppgraderingsflate.
      title: "Timeføring",
      url: "/timeforing",
      icon: <ClockIcon className="size-4" />,
    },
    {
      title: "Kunder",
      url: "/kunder",
      icon: <UsersIcon className="size-4" />,
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
      items: [
        {
          title: "Bedriftsprofil",
          url: "/min-bedrift/bedriftsprofil",
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


function AppSidebarHeader({
  unreadCount,
  notifications,
  notificationsLoading,
  onMarkAllRead,
  onMarkThreadRead,
  canCreateProject,
  roleLoading,
}: {
  unreadCount: number
  notifications: NotificationItem[]
  notificationsLoading: boolean
  onMarkAllRead: () => void
  onMarkThreadRead: (customerId: string) => void
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
              aria-label={`${unreadCount} uleste meldinger`}
            />
          )}
        </div>
        {!isCollapsed && (
          <div className="shrink-0">
            <NotificationsPopover
              notifications={notifications}
              unreadCount={unreadCount}
              loading={notificationsLoading}
              onMarkAllRead={onMarkAllRead}
              onMarkThreadRead={onMarkThreadRead}
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
        <CreateProjectDrawer
          variant="outline"
          size="sm"
          className="w-full mt-1 hover:shadow-sm"
          label={isCollapsed ? "" : "Nytt prosjekt"}
          showIcon
        />
      ) : null}
    </SidebarHeader>
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

  React.useEffect(() => {
    async function fetchProjects() {
      if (!user || role === null) return;
      
      const supabase = createClient();
      
      const { data: projectsData, error } = await supabase
        .from("projects")
        .select("id, name")
        .in("status", ["planning", "active"])
        .order("updated_at", { ascending: false })
        .limit(5);

      if (projectsData && !error) {
        setActiveProjects(
          projectsData.map(p => ({
            name: p.name,
            url: `/prosjekter/${p.id}`,
            icon: <FrameIcon />,
          }))
        );
      }
    }

    fetchProjects();
  }, [user, role]);

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

  return (
    <Sidebar collapsible="icon" {...props}>
      <AppSidebarHeader
        unreadCount={visibleUnreadCount}
        notifications={notifications}
        notificationsLoading={notificationsLoading}
        onMarkAllRead={markAllRead}
        onMarkThreadRead={markThreadRead}
        canCreateProject={!isWorker}
        roleLoading={!roleKnown}
      />
      <SidebarContent>
        {roleKnown ? (
          <NavMain items={filteredNavMain} />
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
