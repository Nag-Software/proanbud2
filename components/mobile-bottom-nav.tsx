"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  CarIcon,
  ClockIcon,
  FolderIcon,
  LayoutDashboardIcon,
  MapIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"
import { useSidebar } from "@/components/ui/sidebar"
import { useUnreadMessages } from "@/hooks/use-unread-messages"
import { useIsNativeApp } from "@/hooks/use-is-native-app"
import { useUserRole } from "@/hooks/use-user-role"
import { useActiveWorkSession } from "@/hooks/use-active-work-session"

/**
 * Bunnmenyen på mobilweb: fire destinasjoner rundt én opphøyd primærhandling,
 * og «Mer …» inn til sidemenyen.
 *
 * VIKTIG — denne lista er BEVISST web-only og speiler ikke lib/nav-items.
 * Den delte lista er kontrakten mot native-appen (se native-nav-bridge), og
 * native tegner sin egen tab bar som ikke kan rendre en opphøyd knapp midt i.
 * Endrer du lib/nav-items for å «få dem like», endrer du samtidig fanene i
 * appen — og pluss-knappen blir en helt vanlig fane der. Hold dem adskilt til
 * appen kan rendre en FAB.
 */

type WebNavItem = {
  href: string
  label: string
  icon: typeof LayoutDashboardIcon
  exact: boolean
}

type WebNavLayout = {
  /** To til venstre for pluss-knappen. */
  left: WebNavItem[]
  /** Én til høyre; «Mer …» tar den siste plassen. */
  right: WebNavItem[]
  /** Den opphøyde midtknappen. */
  primary: { href: string; label: string }
}

const ADMIN_LAYOUT: WebNavLayout = {
  left: [
    { href: "/", label: "Dashbord", icon: LayoutDashboardIcon, exact: true },
    { href: "/prosjekter", label: "Prosjekter", icon: FolderIcon, exact: false },
  ],
  right: [{ href: "/timeforing", label: "Timer", icon: ClockIcon, exact: false }],
  primary: { href: "/nytt-tilbud", label: "Nytt tilbud" },
}

/**
 * Arbeidere har verken dashbord eller tilbud. Midtknappen er derfor stemplinga
 * — den ene handlingen de faktisk gjør ute på plassen — og Timer-fanen faller
 * bort, siden den ville pekt på samme side som knappen. Tilbud, Kalender og
 * Meldinger nås fra «Mer …».
 */
const WORKER_LAYOUT: WebNavLayout = {
  left: [
    { href: "/prosjekter", label: "Prosjekter", icon: FolderIcon, exact: false },
    { href: "/kart", label: "Kart", icon: MapIcon, exact: false },
  ],
  right: [{ href: "/kjorebok", label: "Kjørebok", icon: CarIcon, exact: false }],
  primary: { href: "/timeforing", label: "Stemple inn" },
}

export function MobileBottomNav() {
  const pathname = usePathname()
  const { toggleSidebar } = useSidebar()
  const unreadCount = useUnreadMessages()
  const { hasActiveSession } = useActiveWorkSession()
  const { isWorker, roleKnown } = useUserRole()
  // Inne i native-appen er tab-baren native (matet via native-nav-bridge) —
  // web-kapselen må ikke rendre en meny til.
  const isNative = useIsNativeApp()

  if (isNative) return null

  const layout = isWorker ? WORKER_LAYOUT : ADMIN_LAYOUT
  const isActive = (item: WebNavItem) =>
    item.exact
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(item.href + "/")

  const renderTab = (item: WebNavItem) => {
    const Icon = item.icon
    const active = isActive(item)
    const stampedIn = item.href === "/timeforing" && hasActiveSession

    return (
      <Link
        key={item.href}
        href={item.href}
        aria-label={stampedIn ? `${item.label} – stemplet inn` : item.label}
        aria-current={active ? "page" : undefined}
        className="relative flex flex-1 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium transition-transform active:scale-95"
      >
        <span
          className={cn(
            "relative flex h-7 w-9 items-center justify-center rounded-full transition-colors",
            active && "bg-primary bg-[image:var(--control-sheen)] shadow-[var(--shadow-raised)]"
          )}
        >
          <Icon
            className={cn(
              "size-[19px] transition-colors",
              active ? "text-primary-foreground" : "text-muted-foreground"
            )}
            strokeWidth={active ? 2.1 : 1.8}
          />
          {stampedIn && (
            <span
              aria-hidden
              className="absolute -right-1 -top-0.5 size-2 animate-pulse rounded-full bg-emerald-500 ring-2 ring-background"
            />
          )}
        </span>
        <span
          className={cn(
            "relative max-w-full truncate leading-none",
            active ? "font-semibold text-foreground" : "text-muted-foreground"
          )}
        >
          {item.label}
        </span>
      </Link>
    )
  }

  return (
    <nav
      aria-label="Hovednavigasjon"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex items-end md:hidden"
      style={{
        height: "calc(4rem + env(safe-area-inset-bottom))",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      {/* Flytende glasskapsel. Tre ting gjør at den leses som glass og ikke som
          en hvit stripe: full kapselradius, ekte gjennomsiktighet med kraftig
          blur + metning (innholdet skal skimtes rulle under), og lyskanten
          øverst fra --shadow-glass. */}
      <div className="pointer-events-auto relative mx-3 mb-2 flex h-14 flex-1 items-center gap-0.5 rounded-full border border-[color:var(--glass-border)] bg-[image:var(--glass-surface)] px-1.5 shadow-[var(--shadow-glass)] backdrop-blur-2xl backdrop-saturate-[1.8] not-supports-[backdrop-filter]:bg-background">
        {/* Rollen er ukjent ved aller første besøk (ingen cache ennå) — hold
            plassene med nøytrale skeletons i stedet for å blinke admin-fanene
            for en håndverker. Begge rollevariantene har samme fem plasser, så
            layouten står i ro når rollen lander. */}
        {!roleKnown ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              aria-hidden
              className="relative flex flex-1 flex-col items-center justify-center gap-1"
            >
              <Skeleton className={cn("rounded-full", i === 2 ? "h-12 w-12" : "h-7 w-9")} />
              {i !== 2 && <Skeleton className="h-2 w-9 rounded-full" />}
            </div>
          ))
        ) : (
          <>
            {layout.left.map(renderTab)}

            {/* Primærhandlingen. Løftet ut av rekka og gitt aksentfargen, så
                den leses som «gjør noe» og ikke som «gå et sted» — de fire
                andre er destinasjoner. */}
            <div className="relative flex flex-1 items-center justify-center">
              <Link
                href={layout.primary.href}
                aria-label={layout.primary.label}
                className="flex size-13 -translate-y-3 items-center justify-center rounded-full bg-accent bg-[image:var(--control-sheen)] text-accent-foreground shadow-[var(--shadow-raised)] transition-transform active:scale-95"
              >
                <PlusIcon className="size-6" strokeWidth={2.4} />
              </Link>
            </div>

            {layout.right.map(renderTab)}

            <button
              type="button"
              onClick={toggleSidebar}
              aria-label="Mer"
              className="relative flex flex-1 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium text-muted-foreground transition-transform active:scale-95"
            >
              <span className="relative flex h-7 w-9 items-center justify-center rounded-full">
                <MoreHorizontalIcon className="size-[19px]" strokeWidth={1.8} />
                {/* Meldinger er ikke lenger egen fane, så uleste ville blitt
                    usynlige. Badgen følger med inn i «Mer …». */}
                {unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[9px] font-bold text-white ring-2 ring-background">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </span>
              <span className="relative leading-none">Mer</span>
            </button>
          </>
        )}
      </div>
    </nav>
  )
}
