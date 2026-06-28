"use client"

import * as React from "react"
import Link from "next/link"
import { Archive, MoreVertical } from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { updateProjectAction } from "./actions"
import { ProjectStatusFooter } from "./project-status-footer"
import {
  getProjectCode,
  getProjectCustomer,
  getProjectPeriod,
  getStatusConfig,
  type ProjectRow,
} from "./project-utils"

const MOVE = [
  { value: "planning", label: "Planlegges" },
  { value: "active", label: "Under utførelse" },
  { value: "on_hold", label: "På pause" },
  { value: "completed", label: "Fullført" },
] as const

type ProjectKanbanCardProps = {
  project: ProjectRow
  onRemoved: () => void
  onPatched: (patch: Partial<ProjectRow>) => void
}

export function ProjectKanbanCard({ project, onRemoved, onPatched }: ProjectKanbanCardProps) {
  const confirm = useConfirm()
  const customer = getProjectCustomer(project)
  const current = project.status || "planning"

  // Menu moves are non-optimistic (await → then update state) to avoid the
  // re-insert problem when a card leaves the active board. Drag-to-move stays
  // optimistic and is handled in the board.
  const moveTo = async (status: string) => {
    if (status === current) return
    try {
      await updateProjectAction(project.id, { status })
      if (status === "completed") onRemoved()
      else onPatched({ status })
      toast.success(`Flyttet til ${MOVE.find((m) => m.value === status)?.label}`)
    } catch (error) {
      console.error("Kunne ikke endre status", error)
      reportClientError(error, {
        context: { action: "endre prosjektstatus (kanban)", projectId: project.id },
      })
      toast.error("Kunne ikke endre status – prøv igjen")
    }
  }

  const archive = async () => {
    const ok = await confirm({
      title: "Arkiver prosjekt",
      description: `${project.name} flyttes til tidligere prosjekter. Du kan fortsatt åpne det senere.`,
      confirmText: "Arkiver",
      cancelText: "Avbryt",
    })
    if (!ok) return
    try {
      await updateProjectAction(project.id, { status: "archived" })
      onRemoved()
      toast.success("Prosjekt arkivert")
    } catch (error) {
      console.error("Kunne ikke arkivere prosjekt", error)
      reportClientError(error, {
        context: { action: "arkiver prosjekt (kanban)", projectId: project.id },
      })
      toast.error("Kunne ikke arkivere prosjekt")
    }
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-lg border border-border/60 bg-card transition-colors hover:border-primary/25">
      <div className="absolute right-1.5 top-1.5 z-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:bg-muted/80 hover:text-foreground data-[state=open]:opacity-100"
              onClick={(event) => event.preventDefault()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Prosjektinnstillinger</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Flytt til</DropdownMenuLabel>
            {MOVE.map((m) => (
              <DropdownMenuItem
                key={m.value}
                disabled={m.value === current}
                onSelect={() => void moveTo(m.value)}
              >
                <span
                  className={cn("mr-2 size-2 rounded-full", getStatusConfig(m.value).fillClass)}
                  aria-hidden
                />
                {m.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void archive()}>
              <Archive className="mr-2 h-4 w-4" />
              Arkiver
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <Link href={`/prosjekter/${project.id}`} className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col p-3 pr-9">
          <p className="truncate text-sm font-semibold leading-snug text-foreground group-hover:text-primary">
            {project.name}
          </p>
          <p className="mt-0.5 truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {getProjectCode(project.id)}
          </p>
          <div className="mt-2.5 min-w-0 space-y-0.5 text-xs text-muted-foreground">
            <p className="truncate">{customer.name}</p>
            <p className="truncate tabular-nums">{getProjectPeriod(project)}</p>
          </div>
        </div>
        <ProjectStatusFooter status={project.status} idPrefix={`${project.id}-kanban`} className="w-full" />
      </Link>
    </div>
  )
}
