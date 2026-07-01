"use client"

import * as React from "react"
import { Columns3, LayoutGrid } from "lucide-react"

import { cn } from "@/lib/utils"

export type ProjectsView = "kort" | "kanban"

type ProjectsViewContextValue = {
  view: ProjectsView
  setView: (next: ProjectsView) => void
}

const ProjectsViewContext = React.createContext<ProjectsViewContextValue | null>(null)

// Shared so the toggle (rendered in the filter row on mobile, in the section
// header on desktop) and the active-projects renderer stay in sync without a
// server round-trip — the choice is persisted in the URL via history.replaceState.
export function ProjectsViewProvider({
  initialView,
  children,
}: {
  initialView: ProjectsView
  children: React.ReactNode
}) {
  const [view, setViewState] = React.useState<ProjectsView>(initialView)

  const setView = React.useCallback((next: ProjectsView) => {
    setViewState(next)
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      if (next === "kanban") url.searchParams.set("view", "kanban")
      else url.searchParams.delete("view")
      window.history.replaceState(null, "", url.toString())
    }
  }, [])

  const value = React.useMemo(() => ({ view, setView }), [view, setView])

  return <ProjectsViewContext.Provider value={value}>{children}</ProjectsViewContext.Provider>
}

export function useProjectsView() {
  return React.useContext(ProjectsViewContext)
}

export function ProjectsViewToggle({ className }: { className?: string }) {
  const ctx = useProjectsView()
  if (!ctx) return null
  const { view, setView } = ctx

  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border/60 bg-card p-0.5",
        className
      )}
    >
      {([
        ["kort", "Kort", LayoutGrid],
        ["kanban", "Tavle", Columns3],
      ] as const).map(([val, label, Icon]) => (
        <button
          key={val}
          type="button"
          onClick={() => setView(val)}
          aria-pressed={view === val}
          className={cn(
            "inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
            view === val
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  )
}
