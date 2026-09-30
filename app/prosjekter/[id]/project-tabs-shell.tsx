"use client"

import * as React from "react"
import { usePathname, useSearchParams } from "next/navigation"

import { Tabs } from "@/components/ui/tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { PEOPLE_DEL, resolveProjectTabParam } from "./project-tab-aliases"

export type ProjectTabItem = {
  value: string
  label: string
  shortLabel?: string
  hidden?: boolean
  /**
   * Tall ved fanen. Vises ikke når det er 0. Kan være et løfte fra serveren:
   * da vises fanen med en gang, og tallet dukker opp når det er klart.
   */
  count?: number | Promise<number>
  /** Varsel i stedet for nøytral teller: noe venter på handling. */
  countTone?: "neutral" | "warning"
}

function isPromiseLike(value: unknown): value is Promise<number> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === "function"
}

function TabCount({ count, tone }: { count: number; tone?: ProjectTabItem["countTone"] }) {
  if (!count) return null
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 text-[10.5px] font-semibold leading-4 tabular-nums",
        tone === "warning"
          ? "border-[color:var(--tone-warning)]/30 bg-[color:var(--overlay-warning)] text-[color:var(--tone-warning-strong)]"
          : "bg-muted text-muted-foreground"
      )}
    >
      {count}
    </span>
  )
}

function AsyncTabCount({ count, tone }: { count: Promise<number>; tone?: ProjectTabItem["countTone"] }) {
  return <TabCount count={React.use(count)} tone={tone} />
}

/** Et sted inne i en fane (`?del=`). `nonce` endres ved hvert kall, også til samme sted. */
export type ProjectFocus = { tab: string; del: string | null; nonce: number }

/** En handling fra Registrer-menyen som en fane skal utføre (åpne et skjema o.l.). */
type ProjectIntent = { name: string; id: number }

type ProjectTabState = {
  activeTab: string
  visitedTabs: ReadonlySet<string>
}

type ProjectShellApi = {
  /** Tar imot faner, `?del=`-steder og alle gamle aliaser («avvik», «tilbud» …). */
  navigate: (target: string, del?: string | null) => void
  /** Setter bare `?del=` innenfor fanen som er åpen (filterbytte o.l.). */
  setDel: (del: string | null) => void
  emitIntent: (name: string) => void
  consumeIntent: (id: number) => void
  setPeopleOpen: (open: boolean) => void
}

const ProjectShellApiContext = React.createContext<ProjectShellApi>({
  navigate: () => {},
  setDel: () => {},
  emitIntent: () => {},
  consumeIntent: () => {},
  setPeopleOpen: () => {},
})
const ProjectTabStateContext = React.createContext<ProjectTabState>({
  activeTab: "",
  visitedTabs: new Set(),
})
const ProjectFocusContext = React.createContext<ProjectFocus>({ tab: "", del: null, nonce: 0 })
const ProjectIntentContext = React.createContext<ProjectIntent | null>(null)
const ProjectPeopleContext = React.createContext(false)

type ProjectTabsShellProps = {
  tabs: ProjectTabItem[]
  defaultTab: string
  /** Prosjekttoppen. Ligger inni skallet så Registrer og personpanelet når konteksten. */
  header: React.ReactNode
  children: React.ReactNode
}

const visible = <T extends { hidden?: boolean }>(items: T[]) => items.filter((item) => !item.hidden)

/**
 * Én rad faner (se project-tab-aliases for hvilke og hvorfor). Fanen ligger i
 * `?tab=`, et sted inne i fanen i `?del=`.
 *
 * Skallet eier også tre ting prosjekttoppen og fanene deler:
 * - `navigate()` for lenker mellom faner (Oversikt → Avvik o.l.),
 * - intensjoner fra Registrer-menyen («ny-oppgave», «ny-ekstrajobb» …) som
 *   fanen tar imot også når den monteres for første gang,
 * - om personpanelet er åpent.
 */
export function ProjectTabsShell({ tabs, defaultTab, header, children }: ProjectTabsShellProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isMobile = useIsMobile()

  // Memoisert på `tabs` (stabil referanse fra serveren), så settet, pickTab
  // og URL-effekten under ikke lages på nytt ved hver render. Ellers kunne
  // URL-effekten kjøre med en utdatert adresse rett etter et fanebytte og
  // hoppe tilbake.
  const visibleTabs = React.useMemo(() => visible(tabs), [tabs])
  const visibleValues = React.useMemo(
    () => new Set(visibleTabs.map((tab) => tab.value)),
    [visibleTabs]
  )

  const readUrl = React.useCallback(() => {
    return resolveProjectTabParam(
      searchParams.get("tab"),
      searchParams.get("sub"),
      searchParams.get("ks"),
      searchParams.get("del")
    )
  }, [searchParams])

  const pickTab = React.useCallback(
    (tab: string | undefined) => (tab && visibleValues.has(tab) ? tab : defaultTab),
    [defaultTab, visibleValues]
  )

  const initial = readUrl()
  const [activeTab, setActiveTab] = React.useState(() => pickTab(initial?.tab))
  const [focus, setFocus] = React.useState<ProjectFocus>(() => ({
    tab: pickTab(initial?.tab),
    del: initial?.del && initial.del !== PEOPLE_DEL ? initial.del : null,
    nonce: 0,
  }))
  const [peopleOpen, setPeopleOpen] = React.useState(initial?.del === PEOPLE_DEL)
  const [intent, setIntent] = React.useState<ProjectIntent | null>(null)
  const [visitedTabs, setVisitedTabs] = React.useState<ReadonlySet<string>>(
    () => new Set([pickTab(initial?.tab)])
  )

  const writeUrl = React.useCallback(
    (tab: string, del: string | null) => {
      const params = new URLSearchParams(searchParams.toString())
      // Gamle parametere ryddes bort så adressen alltid står i dagens form.
      params.delete("sub")
      params.delete("ks")
      if (tab === defaultTab) params.delete("tab")
      else params.set("tab", tab)
      if (del) params.set("del", del)
      else params.delete("del")
      const query = params.toString()
      // replaceState framfor router.replace: et fanebytte skal ikke kjøre hele
      // server-komponenten (og alle Supabase-spørringene) på nytt.
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname)
    },
    [defaultTab, pathname, searchParams]
  )

  // Dyplenker og back/forward går gjennom URL-en.
  React.useEffect(() => {
    const next = readUrl()
    if (!next) {
      if (!searchParams.get("del")) setActiveTab(defaultTab)
      return
    }
    const tab = pickTab(next.tab)
    setActiveTab(tab)
    if (next.del === PEOPLE_DEL) {
      setPeopleOpen(true)
      return
    }
    setFocus((prev) =>
      prev.tab === tab && prev.del === (next.del ?? null)
        ? prev
        : { tab, del: next.del ?? null, nonce: prev.nonce + 1 }
    )
  }, [readUrl, pickTab, defaultTab, searchParams])

  // Alt som har vært åpnet holdes montert, så retur er umiddelbar.
  React.useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev
      const next = new Set(prev)
      next.add(activeTab)
      return next
    })
  }, [activeTab])

  const navigate = React.useCallback(
    (target: string, del?: string | null) => {
      const resolved = resolveProjectTabParam(target) ?? { tab: target }
      const nextDel = del !== undefined ? del : (resolved.del ?? null)
      if (nextDel === PEOPLE_DEL) {
        setPeopleOpen(true)
        return
      }
      const tab = pickTab(resolved.tab)
      setActiveTab(tab)
      setFocus((prev) => ({ tab, del: nextDel, nonce: prev.nonce + 1 }))
      writeUrl(tab, nextDel)
    },
    [pickTab, writeUrl]
  )

  const setDel = React.useCallback(
    (del: string | null) => {
      setFocus((prev) => ({ tab: activeTab, del, nonce: prev.nonce }))
      writeUrl(activeTab, del)
    },
    [activeTab, writeUrl]
  )

  const intentCounter = React.useRef(0)
  const emitIntent = React.useCallback((name: string) => {
    intentCounter.current += 1
    setIntent({ name, id: intentCounter.current })
  }, [])
  const consumeIntent = React.useCallback((id: number) => {
    setIntent((current) => (current?.id === id ? null : current))
  }, [])

  // Lukkes panelet som ble åpnet fra en lenke (?del=personer), ryddes
  // adressen, ellers åpner neste URL-endring panelet igjen.
  const changePeopleOpen = React.useCallback(
    (open: boolean) => {
      setPeopleOpen(open)
      if (!open && searchParams.get("del") === PEOPLE_DEL) writeUrl(activeTab, null)
    },
    [activeTab, searchParams, writeUrl]
  )

  const api = React.useMemo<ProjectShellApi>(
    () => ({ navigate, setDel, emitIntent, consumeIntent, setPeopleOpen: changePeopleOpen }),
    [navigate, setDel, emitIntent, consumeIntent, changePeopleOpen]
  )

  const tabState = React.useMemo<ProjectTabState>(
    () => ({ activeTab, visitedTabs }),
    [activeTab, visitedTabs]
  )

  return (
    <ProjectShellApiContext.Provider value={api}>
      <ProjectTabStateContext.Provider value={tabState}>
        <ProjectFocusContext.Provider value={focus}>
          <ProjectIntentContext.Provider value={intent}>
            <ProjectPeopleContext.Provider value={peopleOpen}>
              {header}
              <Tabs value={activeTab} className="w-full">
                <div className="relative -mx-4 mb-4 sm:mx-0">
                  <div
                    role="tablist"
                    aria-label="Prosjektfaner"
                    className="overflow-x-auto border-b px-4 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden"
                  >
                    <div className="flex w-max items-center gap-5 sm:gap-6">
                      {visibleTabs.map((tab) => {
                        const isActive = tab.value === activeTab
                        return (
                          <button
                            key={tab.value}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => navigate(tab.value, null)}
                            className={cn(
                              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 pb-2.5 text-sm transition-colors",
                              isActive
                                ? "border-foreground font-semibold text-foreground"
                                : "border-transparent font-medium text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {isMobile ? (tab.shortLabel ?? tab.label) : tab.label}
                            {isPromiseLike(tab.count) ? (
                              <React.Suspense fallback={null}>
                                <AsyncTabCount count={tab.count} tone={tab.countTone} />
                              </React.Suspense>
                            ) : (
                              <TabCount count={tab.count ?? 0} tone={tab.countTone} />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent sm:hidden"
                  />
                </div>
                {children}
              </Tabs>
            </ProjectPeopleContext.Provider>
          </ProjectIntentContext.Provider>
        </ProjectFocusContext.Provider>
      </ProjectTabStateContext.Provider>
    </ProjectShellApiContext.Provider>
  )
}

/** Gå til en fane, et sted i en fane eller en gammel alias («avvik», «tilbud» …). */
export function useProjectTabNavigation() {
  return React.useContext(ProjectShellApiContext).navigate
}

export function useProjectShell() {
  return React.useContext(ProjectShellApiContext)
}

export function useProjectTabState() {
  return React.useContext(ProjectTabStateContext)
}

/**
 * Stedet inne i en fane (`?del=`) når det gjelder denne fanen, ellers null.
 * `nonce` lar fanen reagere på et nytt klikk til samme sted (scrolle dit igjen).
 */
export function useProjectFocus(tab: string) {
  const focus = React.useContext(ProjectFocusContext)
  return focus.tab === tab ? focus : { tab, del: null, nonce: focus.nonce }
}

/**
 * Kjører `handler` når Registrer-menyen ber om `name`. Virker også når fanen
 * monteres først etter at menyvalget ble gjort (fanene lastes lat).
 */
export function useProjectIntent(name: string, handler: () => void) {
  const intent = React.useContext(ProjectIntentContext)
  const { consumeIntent } = React.useContext(ProjectShellApiContext)
  const handlerRef = React.useRef(handler)
  React.useEffect(() => {
    handlerRef.current = handler
  })

  React.useEffect(() => {
    if (!intent || intent.name !== name) return
    consumeIntent(intent.id)
    handlerRef.current()
  }, [intent, name, consumeIntent])
}

export function useProjectPeopleSheet() {
  const open = React.useContext(ProjectPeopleContext)
  const { setPeopleOpen } = React.useContext(ProjectShellApiContext)
  return [open, setPeopleOpen] as const
}
