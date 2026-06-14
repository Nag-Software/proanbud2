"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { ResponsiveTabs, type ResponsiveTabItem } from "@/components/responsive-tabs"

const ProjectTabContext = React.createContext<(tab: string) => void>(() => {})

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
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const visibleTabValues = tabs.filter((tab) => !tab.hidden).map((tab) => tab.value)
  const tabParam = searchParams.get("tab")
  const resolvedDefault =
    tabParam && visibleTabValues.includes(tabParam) ? tabParam : defaultTab

  const [activeTab, setActiveTab] = React.useState(resolvedDefault)

  React.useEffect(() => {
    if (tabParam && visibleTabValues.includes(tabParam)) {
      setActiveTab(tabParam)
      return
    }
    if (!tabParam) {
      setActiveTab(defaultTab)
    }
  }, [tabParam, visibleTabValues, defaultTab])

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
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
    },
    [defaultTab, pathname, router, searchParams]
  )

  return (
    <ProjectTabContext.Provider value={handleTabChange}>
      <ResponsiveTabs value={activeTab} onValueChange={handleTabChange} tabs={tabs}>
        {children}
      </ResponsiveTabs>
    </ProjectTabContext.Provider>
  )
}

export function useProjectTabNavigation() {
  return React.useContext(ProjectTabContext)
}
