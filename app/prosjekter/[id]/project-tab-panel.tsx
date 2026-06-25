"use client"

import * as React from "react"

import { TabsContent } from "@/components/responsive-tabs"
import { cn } from "@/lib/utils"
import { useProjectTabState } from "./project-tabs-shell"

type ProjectTabPanelProps = {
  value: string
  className?: string
  children: React.ReactNode
}

/**
 * Lazy keep-alive replacement for <TabsContent> on the project page.
 *
 * - Lazy: a tab's body is not mounted until the user opens it the first time, so
 *   the four client-fetching tabs (oppgaver/timeforing/filer/etterkalkyle) don't
 *   all fire their fetches on the initial project load.
 * - Keep-alive: once visited, the body stays mounted (forceMount) and is hidden
 *   when inactive, so re-entering the tab is instant — no fetch spinner.
 *
 * Scoped to the project tabs only; the global TabsContent default is unchanged.
 */
export function ProjectTabPanel({ value, className, children }: ProjectTabPanelProps) {
  const { activeTab, visitedTabs } = useProjectTabState()
  const isActive = activeTab === value

  // Not active and never opened → render nothing yet (true lazy mount).
  if (!isActive && !visitedTabs.has(value)) {
    return null
  }

  return (
    <TabsContent
      value={value}
      forceMount
      className={cn(!isActive && "hidden", className)}
    >
      {children}
    </TabsContent>
  )
}
