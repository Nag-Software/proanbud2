"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboardIcon,
  FolderIcon,
  ShieldCheckIcon,
  InboxIcon,
  MenuIcon,
  CalendarDays,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/ui/sidebar"
import { useUnreadMessages } from "@/hooks/use-unread-messages"
import { useUserRole } from "@/hooks/use-user-role"

const fullNavItems = [
  { href: "/", icon: LayoutDashboardIcon, label: "Dashbord", exact: true },
  { href: "/prosjekter", icon: FolderIcon, label: "Prosjekter", exact: false },
  { href: "/hms", icon: ShieldCheckIcon, label: "HMS", exact: false },
  { href: "/meldinger", icon: InboxIcon, label: "Meldinger", exact: false },
]

// Workers only have Projects + Calendar.
const workerNavItems = [
  { href: "/prosjekter", icon: FolderIcon, label: "Prosjekter", exact: false },
  { href: "/kalender", icon: CalendarDays, label: "Kalender", exact: false },
]

export function MobileBottomNav() {
  const pathname = usePathname()
  const { toggleSidebar } = useSidebar()
  const unreadCount = useUnreadMessages()
  const { isWorker, hasFeature, loadingRole } = useUserRole()
  // While the plan context loads, keep items visible to avoid flicker.
  const featureEnabled = (feature: Parameters<typeof hasFeature>[0]) =>
    loadingRole || hasFeature(feature)
  // Hide Proff-only destinations when the plan lacks the feature.
  const FEATURE_BY_HREF: Record<string, Parameters<typeof hasFeature>[0]> = {
    "/hms": "hms",
    "/meldinger": "meldinger",
    "/kalender": "kalender",
  }
  const navItems = (isWorker ? workerNavItems : fullNavItems).filter((item) => {
    const feature = FEATURE_BY_HREF[item.href]
    return !feature || featureEnabled(feature)
  })

  return (
    <nav
      aria-label="Hovednavigasjon"
      className="fixed bottom-0 left-0 right-0 z-50 flex shrink-0 items-stretch border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
      style={{
        height: "calc(4rem + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {navItems.map(({ href, icon: Icon, label, exact }) => {
        const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-medium transition-transform active:scale-90",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "relative flex h-7 w-14 items-center justify-center rounded-full transition-colors",
                isActive && "bg-primary/10"
              )}
            >
              <Icon className={cn("h-[23px] w-[23px]", isActive && "text-primary")} strokeWidth={isActive ? 2.2 : 1.8} />
              {href === "/meldinger" && unreadCount > 0 && (
                <span className="absolute right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-primary-foreground">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </span>
            <span className={cn("leading-none", isActive ? "text-primary" : "text-muted-foreground/80")}>
              {label}
            </span>
          </Link>
        )
      })}

      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Åpne meny"
        className="flex flex-1 flex-col items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-muted-foreground transition-transform active:scale-90"
      >
        <span className="flex h-7 w-14 items-center justify-center rounded-full">
          <MenuIcon className="h-[23px] w-[23px]" strokeWidth={1.8} />
        </span>
        <span className="leading-none text-muted-foreground/80">Meny</span>
      </button>
    </nav>
  )
}
