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
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { LayoutDashboardIcon, UsersIcon, InboxIcon, BadgePercentIcon, Building2Icon, Settings2Icon, FrameIcon, PieChartIcon, MapIcon, Bell, CalendarDays, FolderIcon, FilesIcon, SearchIcon, ShieldCheckIcon } from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { useUserRole } from "@/hooks/use-user-role"
import { canManageSubscription } from "@/lib/roles"
import { useAuth } from "@/components/auth-provider"
import { createClient } from "@/lib/supabase/client"
import { CreateProjectDrawer } from "@/app/prosjekter/create-project-dialog"
import { useUnreadMessages } from "@/hooks/use-unread-messages"
import { useOpenDeviationCount } from "@/hooks/use-open-deviation-count"

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
      title: "Kunder",
      url: "/kunder",
      icon: <UsersIcon className="size-4" />,
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
          title: "Timeføring",
          url: "/min-bedrift/timeforing",
        },
        {
          title: "KS-maler",
          url: "/min-bedrift/ks",
        },
      ]
    },
    {
      title: "Innstillinger",
      url: "/innstillinger",
      icon: <Settings2Icon className="size-4" />,
      items: [
        {
          title: "Generelt",
          url: "/innstillinger/generelt",
          hidden: true,
        },
        {
          title: "Brukere",
          url: "/innstillinger/brukere",
          hidden: true,
        },
        {
          title: "Betaling",
          url: "/innstillinger/betaling",
        },
        {
          title: "Integrasjoner",
          url: "/innstillinger/integrasjoner",
        },
      ],
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


function AppSidebarHeader({ unreadCount }: { unreadCount: number }) {
  const { state } = useSidebar()
  const router = useRouter();
  const isCollapsed = state === "collapsed"

  return (
    <SidebarHeader className="pb-0">
      <div className="flex items-center justify-between p-2 pb-0">
        <Image
          src={isCollapsed ? "/logo/light/icon-primary.svg" : "/logo/light/logo-primary.svg"}
          alt="Proanbud"
          width={isCollapsed ? 24 : 120}
          height={isCollapsed ? 24 : 40}
          className="cursor-pointer"
          onClick={() => router.push("/")}
        />
        {!isCollapsed && (
          <div className="relative shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.push("/meldinger")}
              aria-label={unreadCount > 0 ? `${unreadCount} uleste meldinger` : "Meldinger"}
            >
              <Bell className="h-4 w-4" />
            </Button>
            {unreadCount > 0 && (
              <span className="pointer-events-none absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-sidebar" />
            )}
          </div>
        )}
      </div>
      <CreateProjectDrawer
        variant="outline"
        size="sm"
        className="w-full mt-1 hover:shadow-sm"
        label={isCollapsed ? "" : "Nytt prosjekt"}
        showIcon
      />
      {!isCollapsed && (
        <div hidden className="px-2 mt-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Søk i prosjekter..."
              className="w-full pl-8 h-8 hover:shadow-sm outline-none"
             />
          </div>
        </div>
      )}
    </SidebarHeader>
  )
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { role, canonicalRole, hasFeature, loadingRole } = useUserRole();
  const { user } = useAuth();
  const unreadCount = useUnreadMessages();
  const openDeviationCount = useOpenDeviationCount();
  const [activeProjects, setActiveProjects] = React.useState<SidebarProject[]>([]);
  const isWorker = canonicalRole === "worker";
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
          // Hide the KS-maler subitem when the plan lacks the KS feature.
          items: item.items.filter(
            (subItem) => subItem.title !== "KS-maler" || featureEnabled("ks")
          ),
        };
      }
      if (item.title === "Innstillinger" && item.items) {
        return {
          ...item,
          items: item.items.filter(
            (subItem) => subItem.title !== "Betaling" || canManageBilling
          ),
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
    // Workers have a deliberately small surface: only Projects and Calendar.
    if (isWorker) {
      return ["Prosjekter", "Kalender"].includes(item.title);
    }
    if (item.title === "Innstillinger" && !canManageBilling) {
      return false;
    }
    return true;
  });

  return (
    <Sidebar collapsible="icon" {...props}>
      <AppSidebarHeader unreadCount={visibleUnreadCount} />
      <SidebarContent>
        <NavMain items={filteredNavMain} />
        <NavProjects projects={activeProjects} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
