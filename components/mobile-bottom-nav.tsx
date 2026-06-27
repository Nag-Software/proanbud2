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
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex items-end md:hidden"
      style={{
        height: "calc(4rem + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Floating frosted-glass pill (iOS-native feel). */}
      <div className="pointer-events-auto relative mx-3 mb-2 flex h-14 flex-1 items-stretch gap-0 rounded-[1.25rem] border border-border/50 bg-background/55 px-1 shadow-[0_8px_30px_rgba(0,0,0,0.14)] ring-1 ring-black/[0.04] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/10 dark:bg-background/45 dark:ring-white/5 supports-[backdrop-filter]:bg-background/45">
        {/* Top sheen — the "liquid glass" highlight. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[1.25rem] bg-gradient-to-b from-white/25 to-transparent opacity-70 dark:from-white/10"
        />

        {navItems.map(({ href, icon: Icon, label, exact }) => {
          const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className="relative flex flex-1 flex-col items-center justify-center px-3! gap-1 rounded-[1.4rem] text-[11px] font-medium transition active:scale-90"
            >
              {isActive && (
                <span
                  aria-hidden
                  className="absolute inset-x-1.5 inset-y-1 rounded-[1.1rem] bg-primary/8 backdrop-blur-2xl ring-1 ring-inset ring-primary/15 dark:bg-primary/20"
                />
              )}
              <span className="relative flex items-center justify-center">
                <Icon
                  className={cn("size-[22px] transition-colors", isActive ? "text-primary" : "text-muted-foreground")}
                  strokeWidth={isActive ? 2.2 : 1.8}
                />
                {href === "/meldinger" && unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-primary-foreground ring-2 ring-background">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
              <span className={cn("relative leading-none", isActive ? "text-primary" : "text-muted-foreground")}>
                {label}
              </span>
            </Link>
          )
        })}

        <button
          type="button"
          onClick={toggleSidebar}
          aria-label="Åpne meny"
          className="relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[1.4rem] text-[11px] font-medium text-muted-foreground transition active:scale-90"
        >
          <span className="relative flex items-center justify-center">
            <MenuIcon className="size-[22px]" strokeWidth={1.8} />
          </span>
          <span className="relative leading-none">Meny</span>
        </button>
      </div>
    </nav>
  )
}
