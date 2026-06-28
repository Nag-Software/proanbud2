"use client"

import * as React from "react"
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { cn } from "@/lib/utils"
import { updateProjectAction } from "./actions"
import { ProjectKanbanCard } from "./project-kanban-card"
import { getStatusConfig, type ProjectRow } from "./project-utils"

const COLUMNS = [
  { value: "planning", label: "Planlegges" },
  { value: "active", label: "Under utførelse" },
  { value: "on_hold", label: "På pause" },
] as const

// theme classes only set per-side colours; the column's top accent needs the
// raw tone variable so we can paint border-top-color inline.
const TOP_BORDER: Record<string, string> = {
  planning: "var(--tone-warning)",
  active: "var(--accent)",
  on_hold: "var(--tone-neutral)",
}

type ProjectKanbanBoardProps = {
  projects: ProjectRow[]
}

export default function ProjectKanbanBoard({ projects: initial }: ProjectKanbanBoardProps) {
  const [projects, setProjects] = React.useState(initial)

  // Re-sync when the server sends a fresh list (e.g. after a project is created
  // or renamed elsewhere and the route revalidates).
  React.useEffect(() => {
    setProjects(initial)
  }, [initial])

  const handleDragEnd = async (result: DropResult) => {
    const { source, destination, draggableId } = result
    if (!destination || source.droppableId === destination.droppableId) return

    const newStatus = destination.droppableId
    const snapshot = projects

    // Optimistic move so the card lands in the new column instantly.
    setProjects((prev) =>
      prev.map((p) => (p.id === draggableId ? { ...p, status: newStatus } : p))
    )

    try {
      await updateProjectAction(draggableId, { status: newStatus })
    } catch (error) {
      console.error("Kunne ikke flytte prosjekt", error)
      reportClientError(error, {
        context: { action: "flytte prosjekt (kanban)", projectId: draggableId },
      })
      setProjects(snapshot)
      toast.error("Kunne ikke flytte prosjektet – prøv igjen")
    }
  }

  const onRemoved = React.useCallback(
    (id: string) => setProjects((prev) => prev.filter((p) => p.id !== id)),
    []
  )
  const onPatched = React.useCallback(
    (id: string, patch: Partial<ProjectRow>) =>
      setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    []
  )

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid gap-3 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const config = getStatusConfig(column.value)
          const items = projects.filter((p) => (p.status || "planning") === column.value)
          return (
            <Droppable key={column.value} droppableId={column.value}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    "flex min-h-[8rem] flex-col gap-2.5 rounded-xl border border-t-2 border-border/60 bg-muted/20 p-2.5 transition-colors",
                    snapshot.isDraggingOver && "bg-muted/50"
                  )}
                  style={{ borderTopColor: TOP_BORDER[column.value] }}
                >
                  <div className="flex items-center gap-2 px-1 pb-0.5 pt-1">
                    <span
                      className={cn("size-2 shrink-0 rounded-full", config.fillClass)}
                      aria-hidden
                    />
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
                      {column.label}
                    </span>
                    <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border/70 bg-card px-1.5 text-[11px] font-semibold text-muted-foreground">
                      {items.length}
                    </span>
                  </div>

                  {items.map((project, index) => (
                    <Draggable key={project.id} draggableId={project.id} index={index}>
                      {(dragProvided, dragSnapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          {...dragProvided.dragHandleProps}
                          className={cn(dragSnapshot.isDragging && "opacity-90")}
                        >
                          <ProjectKanbanCard
                            project={project}
                            onRemoved={() => onRemoved(project.id)}
                            onPatched={(patch) => onPatched(project.id, patch)}
                          />
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}

                  {items.length === 0 && !snapshot.isDraggingOver && (
                    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
                      Slipp prosjekt her
                    </p>
                  )}
                </div>
              )}
            </Droppable>
          )
        })}
      </div>
    </DragDropContext>
  )
}
