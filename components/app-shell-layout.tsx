"use client"

import { usePathname } from "next/navigation"
import { useState, type ReactNode } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { AppShellProvider, useAppShell } from "@/components/app-shell-context"
import { MobileBottomNav, MOBILE_NAV_HEIGHT } from "@/components/mobile-bottom-nav"
import { GlobalSearch, GlobalSearchTrigger } from "@/components/search/global-search"
import { TutorialWizard } from "@/components/onboarding/tutorial-wizard"
import { NativeNavBridge, NativeNavState } from "@/components/native-nav-bridge"
import { PresenceHeartbeat } from "@/components/presence-heartbeat"
import { RefreshOnReturn } from "@/components/perf/refresh-on-return"
import { IntentPrefetch } from "@/components/perf/intent-prefetch"
import { useNativeAppFlag, useNativePlatform } from "@/hooks/use-is-native-app"
import { useCompanyNotifications } from "@/hooks/use-company-notifications"
import { useUserRole } from "@/hooks/use-user-role"
import { TrialBanner } from "@/components/billing/trial-banner"
import { ShellBreadcrumb } from "@/components/shell-breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { APP_NAV_ENTRIES } from "@/lib/app-nav"
import { FULL_NAV_ITEMS, WORKER_NAV_ITEMS } from "@/lib/nav-items"
import { isPublicAuthRoute } from "@/lib/auth/routes"
import { isSjefenRoute } from "@/lib/auth/platform-admin"
import { isSelgerRoute } from "@/lib/auth/platform-seller"
import { cn } from "@/lib/utils"

function shouldUsePersistentShell(pathname: string) {
  if (isPublicAuthRoute(pathname)) return false
  if (pathname.startsWith("/onboarding")) return false
  if (pathname === "/ingen-tilgang") return false
  if (pathname === "/abonnement-utlopt") return false
  if (isSjefenRoute(pathname)) return false
  if (isSelgerRoute(pathname)) return false
  return true
}

/**
 * Menyknappen. På mobil bor bjella inne i sidebaren, så et ulest tilbudsvarsel
 * (kunden åpnet tilbudet / e-posten kom ikke frem) får en prikk her — ellers
 * ser ingen det før de tilfeldigvis åpner menyen. Deler datakilde med bjella.
 */
function ShellSidebarTrigger() {
  const { isWorker, roleKnown } = useUserRole()
  const { unreadCount } = useCompanyNotifications({ enabled: roleKnown && !isWorker })

  return (
    <span className="relative -ml-1 inline-flex">
      <SidebarTrigger />
      {unreadCount > 0 && (
        <span
          className="pointer-events-none absolute right-0.5 top-0.5 size-2 rounded-full bg-primary ring-2 ring-background md:hidden"
          aria-label={`${unreadCount} uleste varsler`}
        />
      )}
    </span>
  )
}

/**
 * Sider appen selv har en inngang til — fanene og «Mer»-arket. Der tegner den
 * native skallet allerede tittel (og tilbakepil fra «Mer»), så webens topplinje
 * er overflødig. Alt UNDER disse (et prosjekt, et tilbud, «Nytt tilbud» fra
 * hjemmet) nås bare via SPA-navigasjon i WebViewen, og trenger en tilbake-rad.
 */
const NATIVE_ROOT_PATHS = new Set<string>([
  "/",
  ...FULL_NAV_ITEMS.map((item) => item.href),
  ...WORKER_NAV_ITEMS.map((item) => item.href),
  ...APP_NAV_ENTRIES.map((entry) => entry.href),
])

function PersistentShellFrame({ children }: { children: ReactNode }) {
  const shell = useAppShell()
  const pathname = usePathname()
  const isNative = useNativeAppFlag()
  const nativePlatform = useNativePlatform()
  // På iOS er hver fane (og hvert «Mer»-ark) sin egen WebView som starter på
  // fanens egen side. Alt den navigerer til etterpå — også en annen fanes
  // rotside, som Timer-lenken fra hjemmet — trenger en vei tilbake, ellers er
  // fanen låst der. Android har én WebView som bytter rot via den dokkede
  // baren, så der er rotsidene rot uansett hvordan man kom dit.
  const [initialPath] = useState(pathname)
  const isNativeRoot =
    NATIVE_ROOT_PATHS.has(pathname) && (pathname === initialPath || nativePlatform === "android")
  const segments = shell?.pageMeta.segments ?? []
  const noPadding = shell?.pageMeta.noPadding ?? false
  const hideMobileTitle = shell?.pageMeta.hideMobileTitle ?? false

  return (
    <SidebarProvider>
      <PresenceHeartbeat />
      {/* Henter siden brukeren peker på / trykker på, og frisker opp siden
          når man kommer tilbake til fanen. Rendrer ingenting. */}
      <IntentPrefetch />
      <RefreshOnReturn />
      <NativeNavBridge />
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <TrialBanner />
        {/* I appen ligger navigasjonen i den native fanelinjen og «Mer»-arket
            har sitt eget søk, så på sidene appen selv har inngang til
            (NATIVE_ROOT_PATHS) er denne linjen bare en dobbel topplinje —
            native-hide. På undersider (prosjekt, tilbud …) beholdes den som en
            slank tilbake-rad: pilen og tittelen fra ShellBreadcrumb, uten
            hamburger og søk. Sidebaren (profil, varsler, Min konto) åpnes i
            appen fra initialene øverst på hjemmet (components/mobile-home). */}
        <header
          className={cn(
            "flex h-14 shrink-0 items-center gap-2 transition-[width,height] ease-linear md:h-16 group-has-data-[collapsible=icon]/sidebar-wrapper:h-12",
            isNativeRoot && "native-hide"
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
            {/* Bunnmenyen har ikke lenger en «Meny»-fane (den plassen gikk til
                en ekte destinasjon), så hamburgeren er igjen veien inn til
                sidebaren på mobil — der profil, varsler og prosjektsnarveier
                bor. «Mer»-arket i bunnbaren dekker sidene, ikke kontoen. */}
            <span className="native-hide inline-flex">
              <ShellSidebarTrigger />
            </span>
            <Separator
              orientation="vertical"
              className="mr-2 hidden data-vertical:h-4 data-vertical:self-auto md:block"
            />
            <ShellBreadcrumb
              segments={segments}
              hideMobileTitle={hideMobileTitle}
              // I appen har alle undersider en vei tilbake, også de med én
              // crumb («Nytt tilbud» fra hjemmet) — ellers er fanen eneste utvei.
              forceBack={isNative && !isNativeRoot}
            />
          </div>
          <div className="native-hide flex shrink-0 items-center pr-4">
            <GlobalSearchTrigger />
          </div>
        </header>
        <div
          className={cn(
            "shell-scroll flex min-h-0 w-full max-w-[2000px] min-w-0 flex-1 flex-col overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            noPadding ? "overflow-hidden" : "gap-4 p-4 pt-0 pb-4 md:pb-4"
          )}
        >
          {children}
        </div>
        {/* Spacer reserving room for the fixed mobile bottom nav (incl. safe area).
            Kun mobilweb: begge appene slutter WebViewen OVER sin egen bar
            (iOS: src/insets.ts i proanbud-app, Android: dokket bar under), så
            der ble dette en hvit stripe mellom innholdet og fanelinjen. */}
        {nativePlatform === null && (
          <div
            className="shrink-0 md:hidden"
            style={{ height: `calc(${MOBILE_NAV_HEIGHT} + env(safe-area-inset-bottom))` }}
            aria-hidden="true"
          />
        )}
      </SidebarInset>
      <MobileBottomNav />
      {/* Tutorial-veiviser for nye brukere — inne i SidebarProvider fordi den
          styrer sidebar-tilstanden (ekspanderer før spotlight). Skallet
          persisterer på tvers av navigasjon, så guiden overlever sideskift. */}
      <TutorialWizard />
      {/* Globalt ⌘K-søk — montert én gang i skallet så hurtigtasten virker
          på alle sider. */}
      <GlobalSearch />
    </SidebarProvider>
  )
}

export function AppShellLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const useShell = shouldUsePersistentShell(pathname)

  return (
    <>
      {/* Always mounted: the native tab bar needs pathname + shell-visibility
          even on routes without the shell (login, onboarding, sjefen …). */}
      <NativeNavState shell={useShell} />
      {useShell ? (
        <AppShellProvider enabled>
          <PersistentShellFrame>{children}</PersistentShellFrame>
        </AppShellProvider>
      ) : (
        children
      )}
    </>
  )
}
