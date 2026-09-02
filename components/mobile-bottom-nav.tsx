"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  LayoutDashboardIcon,
  FolderIcon,
  FileTextIcon,
  InboxIcon,
  MoreHorizontalIcon,
  MapIcon,
  CalendarDays,
  CarIcon,
  ClockIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { NavMoreMenu } from "@/components/nav-more-menu"
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

/** Barens høyde uten safe-area. Delt med spacer-en i app-shell-layout. */
export const MOBILE_NAV_HEIGHT = "3.75rem"

export function MobileBottomNav() {
  const pathname = usePathname()
  const unreadCount = useUnreadMessages()
  const { hasActiveSession } = useActiveWorkSession()
  const { navItems, roleKnown } = useNavItems()
  const [moreOpen, setMoreOpen] = React.useState(false)
  // Inside the native app the tab bar is native (fed via native-nav-bridge) —
  // the web bar must not render a second menu.
  const isNative = useIsNativeApp()

  // Meldinger ligger ikke lenger i baren, så ulest-varselet ville forsvunnet
  // ut av syne på mobil. Det følger med til «Mer», der meldinger nå bor.
  const moreBadge = unreadCount

  const primaryHrefs = React.useMemo(() => navItems.map((item) => item.href), [navItems])

  if (isNative) return null

  return (
    <>
      {/* Dokket, flat bar — ikke en flytende pille. Den deler flate og
          hårlinje med resten av appen, så den leses som en del av verktøyet
          og ikke som et objekt som svever over det. Ingen radius, ingen blur:
          appen kjører --radius 5px, og en 999px-kapsel motsier den. */}
      <nav
        aria-label="Hovednavigasjon"
        className="fixed inset-x-0 bottom-0 z-50 flex items-stretch border-t border-border bg-background md:hidden"
        style={{
          height: `calc(${MOBILE_NAV_HEIGHT} + env(safe-area-inset-bottom))`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* Rollen er ukjent ved aller første besøk (ingen cache ennå) — hold
            plassene med nøytrale skeletons i stedet for å blinke admin-fanene
            for en håndverker. Begge rollevariantene har 3 faner + Mer, så
            layouten står i ro når rollen lander. */}
        {!roleKnown &&
          Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              aria-hidden
              className="flex flex-1 flex-col items-center justify-center gap-1.5"
            >
              <Skeleton className="size-[23px] rounded-full" />
              <Skeleton className="h-2.5 w-11 rounded-full" />
            </div>
          ))}

        {roleKnown &&
          navItems.map(({ href, icon, label, exact }) => {
            const Icon = NAV_ICONS[icon]
            const isActive = exact
              ? pathname === href
              : pathname === href || pathname.startsWith(href + "/")
            return (
              <Link
                key={href}
                href={href}
                aria-label={
                  href === "/timeforing" && hasActiveSession ? `${label} – stemplet inn` : label
                }
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex flex-1 flex-col items-center justify-center gap-1.5 text-[11px] font-medium leading-none transition-transform active:scale-95",
                  isActive ? "font-semibold text-foreground" : "text-muted-foreground"
                )}
              >
                {/* Aktiv tilstand er tyngden i ikonet og teksten — ingen brikke
                    bak. Baren skal trekke seg tilbake så innholdet eier
                    skjermen; markøren trenger bare å være tydelig, ikke tung. */}
                <span className="relative flex items-center justify-center">
                  <Icon className="size-[23px]" strokeWidth={isActive ? 2.2 : 1.7} />
                  {href === "/timeforing" && hasActiveSession && (
                    <span
                      aria-hidden
                      className="absolute -right-1.5 -top-0.5 size-2.5 animate-pulse rounded-full bg-emerald-500 ring-2 ring-background"
                    />
                  )}
                </span>
                <span className="max-w-full truncate">{label}</span>
              </Link>
            )
          })}

        {/* «Mer» er tre prikker i en ring, ikke en hamburger: en hamburger
            lover «hovedmenyen», ••• lover «flere valg» — og det siste er det
            arket faktisk inneholder. */}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          aria-label="Mer"
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          className={cn(
            "flex flex-1 flex-col items-center justify-center gap-1.5 text-[11px] font-medium leading-none transition-transform active:scale-95",
            moreOpen ? "text-foreground" : "text-muted-foreground"
          )}
        >
          <span className="relative flex items-center justify-center">
            <span className="flex size-[23px] items-center justify-center rounded-full border-[1.5px] border-current">
              <MoreHorizontalIcon className="size-4" strokeWidth={2.4} />
            </span>
            {moreBadge > 0 && (
              <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-white ring-2 ring-background">
                {moreBadge > 9 ? "9+" : moreBadge}
              </span>
            )}
          </span>
          <span>Mer</span>
        </button>
      </nav>

      {/* Samme ark som sidebarens «Mer» — gruppert, søkbart og bygget av
          lib/app-nav, så en ny side dukker opp her av seg selv. */}
      <NavMoreMenu open={moreOpen} onOpenChange={setMoreOpen} primaryHrefs={primaryHrefs} />
    </>
  )
}
