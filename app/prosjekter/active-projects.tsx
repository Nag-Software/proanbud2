"use client"

import * as React from "react"
import dynamic from "next/dynamic"

import { ProjectCard } from "./project-card"
import { useProjectsView } from "./projects-view"
import type { ClientOption } from "./ny/components/client-autocomplete"
import type { ProjectRow } from "./project-utils"

// @hello-pangea/dnd lives only in the Kanban view — load it on demand so the
// default "Kort" view doesn't ship the dnd engine in the route bundle.
const ProjectKanbanBoard = dynamic(() => import("./project-kanban-board"), {
  ssr: false,
  loading: () => (
    <div className="grid gap-3 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-64 animate-pulse rounded-xl border border-border/60 bg-muted/20" />
      ))}
    </div>
  ),
})

type ActiveProjectsProps = {
  projects: ProjectRow[]
  customers: ClientOption[]
}

export function ActiveProjects({ projects, customers }: ActiveProjectsProps) {
  const view = useProjectsView()?.view ?? "kort"

  return (
    <div className="space-y-2 sm:space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Aktive prosjekter
        </h2>
        <span className="text-xs text-muted-foreground">{projects.length} prosjekter</span>
      </div>

      {projects.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-14 text-center"
          style={{ borderRadius: 5 }}
        >
          <p className="text-sm text-muted-foreground">Ingen aktive prosjekter funnet.</p>
        </div>
      ) : view === "kanban" ? (
        <ProjectKanbanBoard projects={projects} />
      ) : (
        <div
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-5"
          style={{ borderRadius: 5 }}
        >
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} customers={customers} />
          ))}
        </div>
      )}
    </div>
  )
}
