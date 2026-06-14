"use client"

import { usePathname } from "next/navigation"
import { type ReactNode } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { AppShellProvider, useAppShell } from "@/components/app-shell-context"
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
import { cn } from "@/lib/utils"

function shouldUsePersistentShell(pathname: string) {
  if (isPublicAuthRoute(pathname)) return false
  if (pathname.startsWith("/onboarding")) return false
  if (isSjefenRoute(pathname)) return false
  return true
}

function PersistentShellFrame({ children }: { children: ReactNode }) {
  const shell = useAppShell()
  const segments = shell?.pageMeta.segments ?? []
  const noPadding = shell?.pageMeta.noPadding ?? false

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <TrialBanner />
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-vertical:h-4 data-vertical:self-auto"
            />
            <ShellBreadcrumb segments={segments} />
          </div>
        </header>
        <div
          className={cn(
            "flex min-h-0 w-full max-w-[2000px] min-w-0 flex-1 flex-col overflow-y-auto @apply [scrollbar-width:none] [&::-webkit-scrollbar]:hidden;",
            noPadding ? "overflow-hidden" : "gap-4 p-4 pt-0"
          )}
        >
          {children}
        </div>
      </SidebarInset>
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
