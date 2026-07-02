"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboardIcon,
  FolderIcon,
  FileTextIcon,
  InboxIcon,
  MenuIcon,
  MapIcon,
  CalendarDays,
  CarIcon,
  ClockIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useSidebar } from "@/components/ui/sidebar"
import { useUnreadMessages } from "@/hooks/use-unread-messages"
import { useNavItems } from "@/hooks/use-nav-items"
import { useIsNativeApp } from "@/hooks/use-is-native-app"
import { useActiveWorkSession } from "@/hooks/use-active-work-session"
import type { NavIconKey } from "@/lib/nav-items"

// Item definitions (roles, feature gates) live in lib/nav-items — shared with
// the native-app bridge. Here we only map the stable icon keys to lucide.
const NAV_ICONS: Record<NavIconKey, typeof LayoutDashboardIcon> = {
  dashboard: LayoutDashboardIcon,
  projects: FolderIcon,
  offers: FileTextIcon,
  hours: ClockIcon,
  messages: InboxIcon,
  map: MapIcon,
  trips: CarIcon,
  calendar: CalendarDays,
}

export function MobileBottomNav() {
  const pathname = usePathname()
  const { toggleSidebar } = useSidebar()
  const unreadCount = useUnreadMessages()
  const { hasActiveSession } = useActiveWorkSession()
  const { navItems, roleKnown } = useNavItems()
  // Inside the native app the tab bar is native (fed via native-nav-bridge) —
  // the web pill must not render a second menu.
  const isNative = useIsNativeApp()
  // Med 5 nav-punkter + Meny blir det 6 kolonner — stram inn padding og
  // skriftstørrelse litt så «Prosjekter»/«Meldinger» ikke kolliderer på smale
  // skjermer. Fire eller færre punkter beholder dagens romslige layout.
  // Skeleton-tilstanden har 5 plasser og bruker derfor også kompakt layout.
  const isCompact = !roleKnown || navItems.length >= 5

  if (isNative) return null

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

        {/* Rollen er ukjent ved aller første besøk (ingen cache ennå) — hold
            plassene med nøytrale skeletons i stedet for å blinke admin-fanene
            for en håndverker. Begge rollevariantene har 5 faner + Meny, så
            layouten står i ro når rollen lander. */}
        {!roleKnown &&
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              aria-hidden
              className="relative flex flex-1 flex-col items-center justify-center gap-1.5"
            >
              <Skeleton className="size-[22px] rounded-md" />
              <Skeleton className="h-2 w-9 rounded-full" />
            </div>
          ))}

        {roleKnown && navItems.map(({ href, icon, label, exact }) => {
          const Icon = NAV_ICONS[icon]
          const isActive = exact ? pathname === href : pathname === href || pathname.startsWith(href + "/")
          return (
            <Link
              key={href}
              href={href}
              aria-label={
                href === "/timeforing" && hasActiveSession ? `${label} – stemplet inn` : label
              }
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[1.4rem] font-medium transition active:scale-90",
                isCompact ? "px-1! text-[10px]" : "px-3! text-[11px]"
              )}
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
                {/* Pulserende grønn dot når brukeren er stemplet inn — samme
                    visuelle språk som unread-badgen på Meldinger. */}
                {href === "/timeforing" && hasActiveSession && (
                  <span
                    aria-hidden
                    className="absolute -right-1 -top-0.5 size-2 animate-pulse rounded-full bg-emerald-500 ring-2 ring-background"
                  />
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
          className={cn(
            "relative flex flex-1 flex-col items-center justify-center gap-1 rounded-[1.4rem] font-medium text-muted-foreground transition active:scale-90",
            isCompact ? "px-1 text-[10px]" : "text-[11px]"
          )}
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
