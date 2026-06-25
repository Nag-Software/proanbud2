"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { ResponsiveTabs, type ResponsiveTabItem } from "@/components/responsive-tabs"

const ProjectTabContext = React.createContext<(tab: string) => void>(() => {})

type ProjectTabState = {
  activeTab: string
  visitedTabs: ReadonlySet<string>
}

const ProjectTabStateContext = React.createContext<ProjectTabState>({
  activeTab: "",
  visitedTabs: new Set(),
})

type ProjectTabsShellProps = {
  tabs: ResponsiveTabItem[]
  defaultTab?: string
  children: React.ReactNode
}

export function ProjectTabsShell({
  tabs,
  defaultTab = "oversikt",
  children,
}: ProjectTabsShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const visibleTabValues = tabs.filter((tab) => !tab.hidden).map((tab) => tab.value)
  const tabParam = searchParams.get("tab")
  const resolvedDefault =
    tabParam && visibleTabValues.includes(tabParam) ? tabParam : defaultTab

  const [activeTab, setActiveTab] = React.useState(resolvedDefault)
  // Tabs the user has opened at least once. Their bodies stay mounted (P1.2) so
  // re-entering a client-fetching tab is instant instead of re-fetching.
  const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<string>>(
    () => new Set([resolvedDefault])
  )

  React.useEffect(() => {
    if (tabParam && visibleTabValues.includes(tabParam)) {
      setActiveTab(tabParam)
      return
    }
    if (!tabParam) {
      setActiveTab(defaultTab)
    }
  }, [tabParam, visibleTabValues, defaultTab])

  // Record every tab we land on so it gets kept-alive afterwards.
  React.useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev
      const next = new Set(prev)
      next.add(activeTab)
      return next
    })
  }, [activeTab])

  const handleTabChange = React.useCallback(
    (value: string) => {
      setActiveTab(value)
      const params = new URLSearchParams(searchParams.toString())
      if (value === defaultTab) {
        params.delete("tab")
      } else {
        params.set("tab", value)
      }
      const query = params.toString()
      // Keep the URL shareable WITHOUT triggering a Next navigation. router.replace
      // here would re-run the whole page.tsx server component (re-fetching every
      // Supabase query) on each tab click; history.replaceState only rewrites the
      // address bar. useSearchParams stays in sync, so deep-links + back/forward
      // still select the right tab via the effect above.
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname)
    },
    [defaultTab, pathname, searchParams]
  )

  const tabState = React.useMemo<ProjectTabState>(
    () => ({ activeTab, visitedTabs }),
    [activeTab, visitedTabs]
  )

  return (
    <ProjectTabContext.Provider value={handleTabChange}>
      <ProjectTabStateContext.Provider value={tabState}>
        <ResponsiveTabs value={activeTab} onValueChange={handleTabChange} tabs={tabs}>
          {children}
        </ResponsiveTabs>
      </ProjectTabStateContext.Provider>
    </ProjectTabContext.Provider>
  )
}

export function useProjectTabNavigation() {
  return React.useContext(ProjectTabContext)
}

export function useProjectTabState() {
  return React.useContext(ProjectTabStateContext)
}
