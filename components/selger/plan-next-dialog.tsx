"use client"

// «Planlegg neste handling» — hjertet i aktivitetsbasert salg. Brukes overalt:
// etter fullført oppgave, etter kvalifisering, etter kanban-flytt og fra
// lead-kortet. Hvert åpent lead skal alltid ha én neste handling; finnes en
// åpen oppgave fra før, tilbyr dialogen å erstatte den.

import * as React from "react"
import { CalendarIcon, MailIcon, PhoneIcon, StickyNoteIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { TASK_TYPE_LABELS, type ProspectTaskRow, type TaskType } from "@/lib/selger/types"

const TYPE_ICONS: Record<TaskType, React.ReactNode> = {
  ring: <PhoneIcon className="size-3.5" />,
  epost: <MailIcon className="size-3.5" />,
  mote: <CalendarIcon className="size-3.5" />,
  annet: <StickyNoteIcon className="size-3.5" />,
}

/** Forslag per pipeline-steg — Pipedrive-prinsippet: systemet foreslår, du velger. */
const STAGE_SUGGESTIONS: Record<string, { taskType: TaskType; title: string; days: number }> = {
  ny: { taskType: "ring", title: "Første kontakt", days: 1 },
  kvalifisert: { taskType: "epost", title: "Første e-post", days: 1 },
  kontaktet: { taskType: "epost", title: "Følg opp e-posten", days: 3 },
  dialog: { taskType: "ring", title: "Følg opp svaret — foreslå demo", days: 1 },
  demo: { taskType: "mote", title: "Book demo-møte", days: 1 },
  trial: { taskType: "ring", title: "Onboarding-samtale", days: 1 },
}

function dueInDays(days: number, hour = 9): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const QUICK_DUE = [
  { label: "I dag", compute: () => dueInDays(0, Math.min(new Date().getHours() + 2, 20)) },
  { label: "I morgen", compute: () => dueInDays(1) },
  { label: "Om 3 dager", compute: () => dueInDays(3) },
  { label: "Neste uke", compute: () => dueInDays(7) },
]

type PlanNextDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  prospectId: string
  prospectName: string
  /** Pipeline-steget leadet er (eller nettopp ble flyttet til) — styrer forslaget. */
  stage: string
  /** Ferdig fullført oppgave-id? Da fullføres+planlegges i ETT kall (race-sikkert). */
  completeTaskId?: string | null
  onSaved?: (task: ProspectTaskRow | null) => void
}

export function PlanNextDialog({
  open,
  onOpenChange,
  prospectId,
  prospectName,
  stage,
  completeTaskId,
  onSaved,
}: PlanNextDialogProps) {
  const suggestion = STAGE_SUGGESTIONS[stage] ?? STAGE_SUGGESTIONS.kvalifisert
  const [taskType, setTaskType] = React.useState<TaskType>(suggestion.taskType)
  const [title, setTitle] = React.useState(suggestion.title)
  const [dueAt, setDueAt] = React.useState(() => dueInDays(suggestion.days))
  const [saving, setSaving] = React.useState(false)
  const [offerReplace, setOfferReplace] = React.useState(false)

  // Nytt lead/steg inn → nullstill til forslaget for det steget.
  React.useEffect(() => {
    if (!open) return
    const s = STAGE_SUGGESTIONS[stage] ?? STAGE_SUGGESTIONS.kvalifisert
    setTaskType(s.taskType)
    setTitle(s.title)
    setDueAt(dueInDays(s.days))
    setOfferReplace(false)
  }, [open, stage, prospectId])

  async function save(replace: boolean) {
    setSaving(true)
    try {
      let response: Response
      if (completeTaskId) {
        response = await fetch(`/api/selger/tasks/${completeTaskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            done: true,
            next: { taskType, dueAt, title: title.trim() || undefined },
          }),
        })
      } else {
        response = await fetch("/api/selger/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prospectId,
            taskType,
            dueAt,
            title: title.trim() || undefined,
            replace,
          }),
        })
      }

      const payload = (await response.json().catch(() => ({}))) as {
        task?: ProspectTaskRow
        next?: ProspectTaskRow | null
        error?: string
        code?: string
      }

      if (response.status === 409 && payload.code === "open_task_exists") {
        setOfferReplace(true)
        return
      }
      if (!response.ok) {
        toast.error(payload.error || "Kunne ikke lagre neste handling")
        return
      }

      toast.success("Neste handling planlagt")
      onSaved?.(payload.task ?? payload.next ?? null)
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Planlegg neste handling</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {completeTaskId
              ? `Oppgaven fullføres — hva er neste steg for ${prospectName}?`
              : `Hva er neste steg for ${prospectName}?`}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex flex-col gap-3 px-4 sm:px-0">
          <div className="grid grid-cols-4 gap-1.5">
            {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setTaskType(type)}
                className={cn(
                  "flex flex-col items-center gap-1 border px-2 py-2 text-[11px] font-semibold transition-colors",
                  taskType === type
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-muted-foreground hover:bg-secondary"
                )}
              >
                {TYPE_ICONS[type]}
                {TASK_TYPE_LABELS[type]}
              </button>
            ))}
          </div>

          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Hva skal gjøres?"
            maxLength={300}
          />

          <div className="flex flex-wrap items-center gap-1.5">
            {QUICK_DUE.map((quick) => (
              <button
                key={quick.label}
                type="button"
                onClick={() => setDueAt(quick.compute())}
                className="rounded-full border border-border bg-card px-3 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary"
              >
                {quick.label}
              </button>
            ))}
            <Input
              type="datetime-local"
              className="h-8 w-auto text-xs"
              value={toLocalInputValue(dueAt)}
              onChange={(event) => {
                if (event.target.value) setDueAt(new Date(event.target.value).toISOString())
              }}
            />
          </div>

          {offerReplace && (
            <div className="border border-border bg-secondary/60 px-3 py-2 text-xs">
              Leadet har allerede en åpen oppgave.{" "}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => void save(true)}
                disabled={saving}
              >
                Erstatt den med denne
              </button>
            </div>
          )}
        </div>

        <ResponsiveDialogFooter className="sm:flex-row sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>
            Hopp over
          </Button>
          <Button size="sm" onClick={() => void save(false)} disabled={saving || !dueAt}>
            {saving ? "Lagrer…" : "Lagre neste handling"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
