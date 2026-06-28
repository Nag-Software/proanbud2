"use client"

import { usePathname } from "next/navigation"
import { type ReactNode } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { AppShellProvider, useAppShell } from "@/components/app-shell-context"
import { MobileBottomNav } from "@/components/mobile-bottom-nav"
import { PresenceHeartbeat } from "@/components/presence-heartbeat"
import { TrialBanner } from "@/components/billing/trial-banner"
import { ShellBreadcrumb } from "@/components/shell-breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
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

function PersistentShellFrame({ children }: { children: ReactNode }) {
  const shell = useAppShell()
  const segments = shell?.pageMeta.segments ?? []
  const noPadding = shell?.pageMeta.noPadding ?? false
  const hideMobileTitle = shell?.pageMeta.hideMobileTitle ?? false

  return (
    <SidebarProvider>
      <PresenceHeartbeat />
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <TrialBanner />
        <header className="flex h-14 shrink-0 items-center gap-2 transition-[width,height] ease-linear md:h-16 group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            {/* On mobile the bottom-nav "Meny" tab opens the sidebar, so the
                header hamburger is redundant — hide it to save vertical space. */}
            <SidebarTrigger className="-ml-1 hidden md:flex" />
            <Separator
              orientation="vertical"
              className="mr-2 hidden data-vertical:h-4 data-vertical:self-auto md:block"
            />
            <ShellBreadcrumb segments={segments} hideMobileTitle={hideMobileTitle} />
          </div>
        </header>
        <div
          className={cn(
            "flex min-h-0 w-full max-w-[2000px] min-w-0 flex-1 flex-col overflow-y-auto @apply [scrollbar-width:none] [&::-webkit-scrollbar]:hidden;",
            noPadding ? "overflow-hidden" : "gap-4 p-4 pt-0 pb-4 md:pb-4"
          )}
        >
          {children}
        </div>
        {/* Spacer reserving room for the fixed mobile bottom nav (incl. safe area) */}
        <div
          className="shrink-0 md:hidden"
          style={{ height: "calc(4rem + env(safe-area-inset-bottom))" }}
          aria-hidden="true"
        />
      </SidebarInset>
      <MobileBottomNav />
    </SidebarProvider>
  )
}

export function AppShellLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const useShell = shouldUsePersistentShell(pathname)

  if (!useShell) {
    return <>{children}</>
  }

  return (
    <AppShellProvider enabled>
      <PersistentShellFrame>{children}</PersistentShellFrame>
    </AppShellProvider>
  )
}
