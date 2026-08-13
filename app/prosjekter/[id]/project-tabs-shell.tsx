"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { ResponsiveTabs, type ResponsiveTabItem } from "@/components/responsive-tabs"
import { resolveProjectTabParam } from "./project-tab-aliases"

const ProjectTabContext = React.createContext<(tab: string) => void>(() => {})
const ProjectSubTabContext = React.createContext<(sub: string | null) => void>(() => {})

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
  // ?tab= kan være en alias for en sammenslått fane (f.eks. ks -> kvalitet).
  const resolvedParam = resolveProjectTabParam(tabParam)
  const resolvedDefault =
    resolvedParam && visibleTabValues.includes(resolvedParam.tab)
      ? resolvedParam.tab
      : defaultTab

  const [activeTab, setActiveTab] = React.useState(resolvedDefault)
  // Tabs the user has opened at least once. Their bodies stay mounted (P1.2) so
  // re-entering a client-fetching tab is instant instead of re-fetching.
  const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<string>>(
    () => new Set([resolvedDefault])
  )

  React.useEffect(() => {
    const resolved = resolveProjectTabParam(tabParam)
    if (resolved && visibleTabValues.includes(resolved.tab)) {
      setActiveTab(resolved.tab)
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
      // Kall utenfra kan bruke en gammel alias ("ks"/"avvik") — da lander vi på
      // den sammenslåtte fanen med riktig underfane forhåndsvalgt.
      const resolved = resolveProjectTabParam(value)
      const nextTab = resolved?.tab ?? value
      const nextSub = resolved?.sub ?? null
      setActiveTab(nextTab)
      const params = new URLSearchParams(searchParams.toString())
      if (nextTab === defaultTab) {
        params.delete("tab")
      } else {
        params.set("tab", nextTab)
      }
      // Underfanen hører til fanen vi forlot — nullstill med mindre aliaset
      // peker på en bestemt underfane.
      if (nextSub) {
        params.set("sub", nextSub)
      } else {
        params.delete("sub")
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

  // Underfaner (f.eks. Sjekklister/Avvik inne i Kvalitet) speiles i ?sub= med
  // samme replaceState-triks som fanene, så dyplenker virker uten navigasjon.
  const handleSubTabChange = React.useCallback(
    (sub: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      // Normaliser ?tab= samtidig, slik at en alias-URL ikke blir liggende og
      // peke på en annen underfane enn den som faktisk er valgt.
      if (activeTab === defaultTab) {
        params.delete("tab")
      } else {
        params.set("tab", activeTab)
      }
      if (sub) {
        params.set("sub", sub)
      } else {
        params.delete("sub")
      }
      const query = params.toString()
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname)
    },
    [activeTab, defaultTab, pathname, searchParams]
  )

  const tabState = React.useMemo<ProjectTabState>(
    () => ({ activeTab, visitedTabs }),
    [activeTab, visitedTabs]
  )

  return (
    <ProjectTabContext.Provider value={handleTabChange}>
      <ProjectSubTabContext.Provider value={handleSubTabChange}>
        <ProjectTabStateContext.Provider value={tabState}>
          <ResponsiveTabs value={activeTab} onValueChange={handleTabChange} tabs={tabs}>
            {children}
          </ResponsiveTabs>
        </ProjectTabStateContext.Provider>
      </ProjectSubTabContext.Provider>
    </ProjectTabContext.Provider>
  )
}

export function useProjectTabNavigation() {
  return React.useContext(ProjectTabContext)
}

export function useProjectSubTabNavigation() {
  return React.useContext(ProjectSubTabContext)
}

export function useProjectTabState() {
  return React.useContext(ProjectTabStateContext)
}
