"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { Tabs } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { resolveProjectTabParam } from "./project-tab-aliases"

const ProjectTabContext = React.createContext<(tab: string) => void>(() => {})
const ProjectSubTabContext = React.createContext<(sub: string | null) => void>(() => {})

type ProjectTabState = {
  /** Bladet som vises nå — panelene sammenlikner mot denne. */
  activeTab: string
  visitedTabs: ReadonlySet<string>
}

const ProjectTabStateContext = React.createContext<ProjectTabState>({
  activeTab: "",
  visitedTabs: new Set(),
})

export type ProjectTabItem = {
  value: string
  label: string
  shortLabel?: string
  hidden?: boolean
}

export type ProjectTabGroup = ProjectTabItem & {
  /** Uten underfaner er gruppa selv bladet (Oversikt). */
  subs?: ProjectTabItem[]
}

type ProjectTabsShellProps = {
  groups: ProjectTabGroup[]
  defaultTab?: string
  children: React.ReactNode
}

const visible = <T extends { hidden?: boolean }>(items: T[] | undefined) =>
  (items ?? []).filter((item) => !item.hidden)

/**
 * To nivåer i stedet for elleve faner på rad: gruppa i `?tab=`, siden i
 * `?sub=` (se designlerretet «Prosjekt — 11 faner blir 3»).
 *
 * Panelene kjenner bare bladet sitt («oppgaver», «tilbud» …) og trenger ikke
 * vite hvilken gruppe de havnet i — `activeTab` i konteksten er alltid bladet.
 * Gamle adresser oversettes i project-tab-aliases.
 */
export function ProjectTabsShell({
  groups,
  defaultTab = "oversikt",
  children,
}: ProjectTabsShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isMobile = useIsMobile()

  const visibleGroups = visible(groups)
  const tabParam = searchParams.get("tab")
  const subParam = searchParams.get("sub")

  const groupByValue = React.useMemo(() => {
    const map = new Map<string, ProjectTabGroup>()
    for (const group of groups) map.set(group.value, group)
    return map
  }, [groups])

  const firstLeaf = React.useCallback(
    (groupValue: string) => {
      const group = groupByValue.get(groupValue)
      const subs = visible(group?.subs)
      return subs.length > 0 ? subs[0].value : groupValue
    },
    [groupByValue]
  )

  const resolved = resolveProjectTabParam(tabParam, subParam)
  const initialGroup =
    resolved && groupByValue.has(resolved.tab) ? resolved.tab : defaultTab

  const [activeGroup, setActiveGroup] = React.useState(initialGroup)
  // Siste besøkte side per gruppe — bytter du til Arbeid og tilbake, lander du
  // der du forlot, ikke på den første underfanen igjen.
  const [subByGroup, setSubByGroup] = React.useState<Record<string, string>>(() =>
    resolved?.sub ? { [initialGroup]: resolved.sub } : {}
  )

  const activeLeaf = React.useMemo(() => {
    const group = groupByValue.get(activeGroup)
    const subs = visible(group?.subs)
    if (subs.length === 0) return activeGroup
    const remembered = subByGroup[activeGroup]
    if (remembered && subs.some((sub) => sub.value === remembered)) return remembered
    return subs[0].value
  }, [activeGroup, groupByValue, subByGroup])

  const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<string>>(
    () => new Set([activeLeaf])
  )

  // Dyplenker, back/forward og navigateToTab() utenfra går alle gjennom ?tab=.
  React.useEffect(() => {
    const next = resolveProjectTabParam(tabParam, subParam)
    if (next && groupByValue.has(next.tab)) {
      setActiveGroup(next.tab)
      if (next.sub) setSubByGroup((prev) => ({ ...prev, [next.tab]: next.sub as string }))
      return
    }
    if (!tabParam) setActiveGroup(defaultTab)
  }, [tabParam, subParam, groupByValue, defaultTab])

  // Alt som har vært åpnet holdes montert (P1.2) så retur er umiddelbar.
  React.useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeLeaf)) return prev
      const next = new Set(prev)
      next.add(activeLeaf)
      return next
    })
  }, [activeLeaf])

  const writeUrl = React.useCallback(
    (group: string, sub: string | null, ks?: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      if (group === defaultTab) params.delete("tab")
      else params.set("tab", group)
      if (sub) params.set("sub", sub)
      else params.delete("sub")
      if (ks) params.set("ks", ks)
      else if (ks === null) params.delete("ks")
      const query = params.toString()
      // replaceState framfor router.replace: en fanebytte skal ikke kjøre hele
      // server-komponenten (og alle Supabase-spørringene) på nytt.
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname)
    },
    [defaultTab, pathname, searchParams]
  )

  /** Tar imot både gruppe, blad og gamle aliaser («ks», «avvik», «tilbud» …). */
  const handleTabChange = React.useCallback(
    (value: string) => {
      const target = groupByValue.has(value)
        ? { tab: value, sub: undefined, ks: undefined }
        : (resolveProjectTabParam(value) ?? { tab: value })
      const group = groupByValue.has(target.tab) ? target.tab : defaultTab
      const sub = target.sub ?? (groupByValue.has(value) ? subByGroup[group] : undefined)
      const leaf = sub ?? firstLeaf(group)

      setActiveGroup(group)
      if (leaf !== group) setSubByGroup((prev) => ({ ...prev, [group]: leaf }))
      writeUrl(group, leaf === group ? null : leaf, target.ks ?? null)
    },
    [defaultTab, firstLeaf, groupByValue, subByGroup, writeUrl]
  )

  /** Bladnivået inne i KS & Avvik (?ks=). */
  const handleSubTabChange = React.useCallback(
    (ks: string | null) => {
      writeUrl(activeGroup, activeLeaf === activeGroup ? null : activeLeaf, ks)
    },
    [activeGroup, activeLeaf, writeUrl]
  )

  const tabState = React.useMemo<ProjectTabState>(
    () => ({ activeTab: activeLeaf, visitedTabs }),
    [activeLeaf, visitedTabs]
  )

  const activeSubs = visible(groupByValue.get(activeGroup)?.subs)

  return (
    <ProjectTabContext.Provider value={handleTabChange}>
      <ProjectSubTabContext.Provider value={handleSubTabChange}>
        <ProjectTabStateContext.Provider value={tabState}>
          <Tabs value={activeLeaf} className="w-full">
            <div className="mb-3 flex flex-col gap-2.5">
              {/* Gruppene */}
              <div className="flex items-center gap-5 border-b">
                {visibleGroups.map((group) => {
                  const isActive = group.value === activeGroup
                  return (
                    <button
                      key={group.value}
                      type="button"
                      onClick={() => handleTabChange(group.value)}
                      className={cn(
                        "-mb-px shrink-0 border-b-2 px-0.5 pb-2 text-sm transition-colors",
                        isActive
                          ? "border-foreground font-semibold text-foreground"
                          : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {isMobile ? (group.shortLabel ?? group.label) : group.label}
                    </button>
                  )
                })}
              </div>

              {/* Sidene inne i gruppa */}
              {activeSubs.length > 0 && (
                <div className="relative -mx-4">
                  <div className="overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    <div className="flex w-max items-center gap-1.5">
                      {activeSubs.map((sub) => {
                        const isActive = sub.value === activeLeaf
                        return (
                          <button
                            key={sub.value}
                            type="button"
                            onClick={() => handleTabChange(sub.value)}
                            className={cn(
                              "h-8 shrink-0 rounded-[var(--radius-control)] px-3 text-[13px] font-semibold transition-all",
                              isActive
                                ? "border border-[color:var(--control-border-soft)] bg-background bg-[image:var(--control-sheen-soft)] text-foreground shadow-[var(--shadow-surface)]"
                                : "border border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                          >
                            {isMobile ? (sub.shortLabel ?? sub.label) : sub.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent md:hidden"
                  />
                </div>
              )}
            </div>
            {children}
          </Tabs>
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
