"use client"

// Pipeline-kanban: hele salgsreisen i ett brett. Drag-drop-arkitekturen følger
// app/prosjekter/project-kanban-board.tsx (optimistisk flytt + rollback + toast).
// Vunnet/Tapt er dropsoner som glir opp mens man drar; Tapt krever alltid årsak.

import * as React from "react"
import Link from "next/link"
import { DragDropContext, Draggable, Droppable, type DropResult } from "@hello-pangea/dnd"
import {
  AlertTriangleIcon,
  CheckIcon,
  KanbanIcon,
  ListIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { LostReasonDialog } from "@/components/selger/lost-reason-dialog"
import { PlanNextDialog } from "@/components/selger/plan-next-dialog"
import { reportClientError } from "@/lib/errors/client"
import { cn } from "@/lib/utils"
import {
  OPEN_PIPELINE_STATUSES,
  PROSPECT_STATUS_LABELS,
  type OpenPipelineStatus,
} from "@/lib/outreach/types"
import { rottingFor } from "@/lib/selger/rotting"
import type { LostReason, PipelineLeadRow, ProspectTaskRow } from "@/lib/selger/types"
import { LeadKanbanCard } from "./lead-kanban-card"

const TOP_BORDER: Record<OpenPipelineStatus, string> = {
  kvalifisert: "var(--tone-neutral)",
  kontaktet: "var(--tone-info)",
  dialog: "var(--tone-violet)",
  demo: "var(--tone-warning)",
  trial: "var(--accent)",
}

const COLUMN_DOT: Record<OpenPipelineStatus, string> = {
  kvalifisert: "bg-neutral-400",
  kontaktet: "bg-blue-400",
  dialog: "bg-violet-400",
  demo: "bg-amber-400",
  trial: "bg-lime-400",
}

type ViewMode = "kanban" | "liste"

type PipelineClientProps = {
  initialLeads: PipelineLeadRow[]
}

export function PipelineClient({ initialLeads }: PipelineClientProps) {
  const [leads, setLeads] = React.useState(initialLeads)
  const [view, setView] = React.useState<ViewMode>("kanban")
  const [query, setQuery] = React.useState("")
  const [onlyRotting, setOnlyRotting] = React.useState(false)
  const [dragging, setDragging] = React.useState(false)

  // «Planlegg neste»-dialog etter flytt / fra kort uten oppgave.
  const [planFor, setPlanFor] = React.useState<PipelineLeadRow | null>(null)
  // «Tapt»-dialogen holder flyttingen tilbake til årsaken er valgt.
  const [lostFor, setLostFor] = React.useState<PipelineLeadRow | null>(null)

  React.useEffect(() => setLeads(initialLeads), [initialLeads])

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return leads.filter((lead) => {
      if (q && !`${lead.name} ${lead.city ?? ""} ${lead.nace_description ?? ""}`.toLowerCase().includes(q)) {
        return false
      }
      if (onlyRotting) {
        const rotting = rottingFor(lead.status as OpenPipelineStatus, lead.last_activity_at)
        if (rotting.level === "fresh" && lead.open_task) return false
      }
      return true
    })
  }, [leads, query, onlyRotting])

  async function patchStatus(
    lead: PipelineLeadRow,
    status: string,
    extra?: { lostReason?: LostReason; lostNote?: string }
  ): Promise<boolean> {
    const snapshot = leads
    // Optimistisk: åpne kolonner får kortet flyttet; kunde/tapt fjerner det.
    setLeads((prev) =>
      OPEN_PIPELINE_STATUSES.includes(status as OpenPipelineStatus)
        ? prev.map((l) =>
            l.id === lead.id ? { ...l, status, stage_entered_at: new Date().toISOString() } : l
          )
        : prev.filter((l) => l.id !== lead.id)
    )

    try {
      const response = await fetch(`/api/outreach/prospects/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...extra }),
      })
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(payload.error || "Kunne ikke flytte leadet")
      }
      return true
    } catch (error) {
      reportClientError(error, {
        context: { action: "flytte lead (pipeline)", prospectId: lead.id },
      })
      setLeads(snapshot)
      toast.error(error instanceof Error ? error.message : "Kunne ikke flytte leadet – prøv igjen")
      return false
    }
  }

  const handleDragEnd = async (result: DropResult) => {
    setDragging(false)
    const { source, destination, draggableId } = result
    if (!destination || source.droppableId === destination.droppableId) return

    const lead = leads.find((l) => l.id === draggableId)
    if (!lead) return
    const target = destination.droppableId

    if (target === "tapt") {
      setLostFor(lead)
      return
    }

    const ok = await patchStatus(lead, target)
    if (!ok) return

    if (target === "kunde") {
      toast.success(`${lead.name} markert som vunnet 🎉`)
      return
    }
    // Aktivitetsbasert salg: nytt steg uten åpen oppgave → planlegg neste.
    if (!lead.open_task) {
      setPlanFor({ ...lead, status: target })
    }
  }

  const columns = OPEN_PIPELINE_STATUSES.map((status) => ({
    status,
    label: PROSPECT_STATUS_LABELS[status],
    items: filtered.filter((lead) => lead.status === status),
  }))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Pipeline</h1>
          <p className="text-xs text-muted-foreground">
            {leads.length} åpne leads · {leads.filter((l) => l.status === "trial").length} i trial
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <SearchIcon className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Søk firma …"
              className="h-8 w-44 pl-8 text-sm"
            />
          </div>
          <Button
            variant={onlyRotting ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => setOnlyRotting((v) => !v)}
          >
            <AlertTriangleIcon className="size-3.5" />
            Kun råtnende
          </Button>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setView("kanban")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold",
                view === "kanban" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
              )}
            >
              <KanbanIcon className="size-3.5" /> Kanban
            </button>
            <button
              type="button"
              onClick={() => setView("liste")}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold",
                view === "liste" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground"
              )}
            >
              <ListIcon className="size-3.5" /> Liste
            </button>
          </div>
          <Link
            href="/selger/pipeline/lukket"
            className="text-xs font-semibold text-muted-foreground underline-offset-2 hover:underline"
          >
            Vunnet og tapt →
          </Link>
        </div>
      </div>

      {leads.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="max-w-sm rounded-lg border border-dashed p-8 text-center">
            <p className="font-semibold">Pipelinen er tom</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Kvalifiser leads fra innboksen for å komme i gang.
            </p>
            <Button asChild size="sm" className="mt-4">
              <Link href="/selger/leads">Gå til Leads</Link>
            </Button>
          </div>
        </div>
      ) : view === "kanban" ? (
        <DragDropContext onDragEnd={handleDragEnd} onDragStart={() => setDragging(true)}>
          <div className="min-h-0 flex-1 overflow-x-auto pb-2">
            <div className="flex h-full min-w-[1080px] items-stretch gap-3">
              {columns.map((column) => (
                <Droppable key={column.status} droppableId={column.status}>
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={cn(
                        "flex min-h-[10rem] min-w-[212px] flex-1 flex-col gap-2 overflow-y-auto rounded-xl border border-t-2 border-border/60 bg-muted/20 p-2.5 transition-colors",
                        snapshot.isDraggingOver && "bg-muted/50"
                      )}
                      style={{ borderTopColor: TOP_BORDER[column.status] }}
                    >
                      <div className="flex items-center gap-2 px-1 pb-0.5 pt-1">
                        <span className={cn("size-2 shrink-0 rounded-full", COLUMN_DOT[column.status])} aria-hidden />
                        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
                          {column.label}
                        </span>
                        <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-border/70 bg-card px-1.5 text-[11px] font-semibold text-muted-foreground">
                          {column.items.length}
                        </span>
                      </div>

                      {column.items.map((lead, index) => (
                        <Draggable key={lead.id} draggableId={lead.id} index={index}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              className={cn(dragSnapshot.isDragging && "opacity-90")}
                            >
                              <LeadKanbanCard lead={lead} onPlanNext={setPlanFor} />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}

                      {column.items.length === 0 && !snapshot.isDraggingOver && (
                        <p className="px-1 py-6 text-center text-xs text-muted-foreground">Dra leads hit</p>
                      )}
                    </div>
                  )}
                </Droppable>
              ))}
            </div>
          </div>

          {/* Vunnet/Tapt: synlige kun mens man drar — slipp for å lukke leadet. */}
          <div
            className={cn(
              "grid grid-cols-2 gap-3 transition-all",
              dragging ? "h-16 opacity-100" : "pointer-events-none h-0 overflow-hidden opacity-0"
            )}
          >
            <Droppable droppableId="kunde">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm font-semibold",
                    snapshot.isDraggingOver
                      ? "border-lime-500 bg-lime-50 text-lime-800 dark:bg-lime-950"
                      : "border-lime-300 bg-lime-50/50 text-lime-700 dark:bg-transparent"
                  )}
                >
                  <CheckIcon className="size-4" /> Vunnet — ble kunde
                  <span className="hidden">{provided.placeholder}</span>
                </div>
              )}
            </Droppable>
            <Droppable droppableId="tapt">
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={cn(
                    "flex items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm font-semibold",
                    snapshot.isDraggingOver
                      ? "border-red-500 bg-red-50 text-red-800 dark:bg-red-950"
                      : "border-red-300 bg-red-50/50 text-red-700 dark:bg-transparent"
                  )}
                >
                  <XIcon className="size-4" /> Tapt — velg årsak
                  <span className="hidden">{provided.placeholder}</span>
                </div>
              )}
            </Droppable>
          </div>
        </DragDropContext>
      ) : (
        <PipelineList leads={filtered} onStatusChange={patchStatus} onLost={setLostFor} />
      )}

      {planFor && (
        <PlanNextDialog
          open={Boolean(planFor)}
          onOpenChange={(open) => !open && setPlanFor(null)}
          prospectId={planFor.id}
          prospectName={planFor.name}
          stage={planFor.status}
          onSaved={(task: ProspectTaskRow | null) => {
            if (task) {
              setLeads((prev) =>
                prev.map((l) => (l.id === planFor.id ? { ...l, open_task: task } : l))
              )
            }
            setPlanFor(null)
          }}
        />
      )}

      <LostReasonDialog
        open={Boolean(lostFor)}
        leadName={lostFor?.name ?? ""}
        onClose={() => setLostFor(null)}
        onConfirm={async (reason, note) => {
          if (!lostFor) return
          const ok = await patchStatus(lostFor, "tapt", { lostReason: reason, lostNote: note })
          if (ok) toast.success(`${lostFor.name} markert som tapt`)
          setLostFor(null)
        }}
      />
    </div>
  )
}

// ============================================================
// Liste-visning (mobil-vennlig fallback + sorterbar oversikt)
// ============================================================

function PipelineList({
  leads,
  onStatusChange,
  onLost,
}: {
  leads: PipelineLeadRow[]
  onStatusChange: (lead: PipelineLeadRow, status: string) => Promise<boolean>
  onLost: (lead: PipelineLeadRow) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="divide-y">
        {leads.map((lead) => {
          const rotting = rottingFor(lead.status as OpenPipelineStatus, lead.last_activity_at)
          return (
            <div key={lead.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/selger/leads/${lead.id}`}
                  className="text-sm font-semibold hover:underline"
                >
                  {lead.name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {[lead.nace_description, lead.city].filter(Boolean).join(" · ")}
                  {lead.open_task
                    ? ` — ${lead.open_task.title || "Neste handling planlagt"}`
                    : " — mangler neste steg"}
                </p>
              </div>
              {rotting.level !== "fresh" && (
                <Badge variant="outline" className="theme-badge-status-sent text-[10px]">
                  Råtner · {rotting.days} d
                </Badge>
              )}
              <Select
                value={lead.status}
                onValueChange={(value) => {
                  if (value === "tapt") onLost(lead)
                  else void onStatusChange(lead, value)
                }}
              >
                <SelectTrigger className="h-8 w-36 text-xs" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPEN_PIPELINE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {PROSPECT_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                  <SelectItem value="kunde">Vunnet</SelectItem>
                  <SelectItem value="tapt">Tapt</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </div>
    </div>
  )
}

