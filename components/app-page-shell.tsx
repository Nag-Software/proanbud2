"use client"

import { AppSidebar } from "@/components/app-sidebar"
import { useAppShell } from "@/components/app-shell-context"
import { TrialBanner } from "@/components/billing/trial-banner"
import { ShellBreadcrumb } from "@/components/shell-breadcrumb"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { useLayoutEffect, type ReactNode } from "react"
import { cn } from "@/lib/utils"

type AppPageShellProps = {
  segments: string[]
  children?: ReactNode
  noPadding?: boolean
}

function DefaultCanvas() {
  return (
    <>
      <div className="grid auto-rows-min gap-4 md:grid-cols-3">
        <div className="aspect-video rounded-xl bg-muted/50" />
        <div className="aspect-video rounded-xl bg-muted/50" />
        <div className="aspect-video rounded-xl bg-muted/50" />
      </div>
      <div className="min-h-screen flex-1 rounded-xl bg-muted/50 md:min-h-min" />
    </>
  )
}

function LegacyAppPageShell({ segments, children, noPadding }: AppPageShellProps) {
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
          {children ?? <DefaultCanvas />}
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

export function AppPageShell({ segments, children, noPadding }: AppPageShellProps) {
  const shell = useAppShell()
  const insideShell = shell?.insideShell ?? false
  const setPageMeta = shell?.setPageMeta
  const segmentsKey = segments.join("\u0000")

  useLayoutEffect(() => {
    if (!insideShell || !setPageMeta) return
    setPageMeta({
      segments,
      noPadding: Boolean(noPadding),
    })
  }, [insideShell, setPageMeta, segmentsKey, noPadding])

  if (shell?.insideShell) {
    return <>{children ?? <DefaultCanvas />}</>
  }

  return (
    <LegacyAppPageShell segments={segments} noPadding={noPadding}>
      {children}
    </LegacyAppPageShell>
  )
}
