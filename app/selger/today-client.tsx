"use client"

// «I dag» — selgerens dagskø. Alt som skal gjøres i dag, ferdig prioritert:
// forfalte oppgaver øverst, så dagens, så nye signaler fra pipelinen, og til
// slutt en sammenleggbar «Råtner»-liste. Tom kø = ferdig på jobb.

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  AlertTriangleIcon,
  CalendarIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FlameIcon,
  MailIcon,
  PhoneIcon,
  StickyNoteIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SelgerPageShell } from "@/components/selger/selger-page-shell"
import { PlanNextDialog } from "@/components/selger/plan-next-dialog"
import { cn } from "@/lib/utils"
import { dueLabel, trialDaysLeft } from "@/lib/selger/dates"
import { rottingFor } from "@/lib/selger/rotting"
import { PROSPECT_STATUS_LABELS, type ProspectStatus } from "@/lib/outreach/types"
import type { PipelineLeadRow, TaskWithLead, TaskType } from "@/lib/selger/types"

const TASK_ICONS: Record<TaskType, React.ReactNode> = {
  ring: <PhoneIcon className="size-3.5" />,
  epost: <MailIcon className="size-3.5" />,
  mote: <CalendarIcon className="size-3.5" />,
  annet: <StickyNoteIcon className="size-3.5" />,
}

const STAGE_CHIP: Record<string, string> = {
  kvalifisert: "border-border bg-secondary text-foreground/70",
  kontaktet: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  dialog: "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-300",
  demo: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  trial: "border-lime-300 bg-lime-50 text-lime-800 dark:border-lime-900 dark:bg-lime-950 dark:text-lime-300",
}

type Signal = {
  id: string
  leadId: string
  title: string
  description: string
  action: string
  hot?: boolean
}

/** Signaler fra pipelinen: nye svar, ferske trials, trials som utløper, nye hot. */
function computeSignals(leads: PipelineLeadRow[]): Signal[] {
  const now = Date.now()
  const fresh = (iso: string | null, hours: number) =>
    Boolean(iso) && now - new Date(iso!).getTime() <= hours * 3600_000

  const signals: Signal[] = []
  const seen = new Set<string>()

  for (const lead of leads) {
    if (lead.status === "dialog" && fresh(lead.stage_entered_at, 48) && !seen.has(lead.id)) {
      signals.push({
        id: `dialog-${lead.id}`,
        leadId: lead.id,
        title: `${lead.name} er i dialog`,
        description: "Svarte nylig — smi mens jernet er varmt",
        action: "Følg opp svar",
        hot: true,
      })
      seen.add(lead.id)
      continue
    }
    const daysLeft = lead.status === "trial" ? trialDaysLeft(lead.trial_ends_at) : null
    if (daysLeft !== null && daysLeft >= 0 && daysLeft <= 3 && !seen.has(lead.id)) {
      signals.push({
        id: `trial-exp-${lead.id}`,
        leadId: lead.id,
        title: `Trial utløper om ${daysLeft === 0 ? "under ett døgn" : `${daysLeft} ${daysLeft === 1 ? "dag" : "dager"}`}`,
        description: lead.name,
        action: "Ring trial",
      })
      seen.add(lead.id)
      continue
    }
    if (lead.status === "trial" && fresh(lead.stage_entered_at, 48) && !seen.has(lead.id)) {
      signals.push({
        id: `trial-new-${lead.id}`,
        leadId: lead.id,
        title: `Ny trial: ${lead.name}`,
        description: "Registrerte seg selv — ingen kontakt ennå",
        action: "Ring velkommen",
      })
      seen.add(lead.id)
      continue
    }
    if (lead.is_hot && fresh(lead.hot_since, 48) && !seen.has(lead.id)) {
      signals.push({
        id: `hot-${lead.id}`,
        leadId: lead.id,
        title: `${lead.name} viser interesse`,
        description: `Åpnet ${lead.open_count}× · klikket ${lead.click_count}×`,
        action: "Ring nå",
        hot: true,
      })
      seen.add(lead.id)
    }
  }
  return signals.slice(0, 8)
}

export function TodayClient({
  initialTasks,
  leads,
}: {
  initialTasks: TaskWithLead[]
  leads: PipelineLeadRow[]
}) {
  const router = useRouter()
  const [tasks, setTasks] = React.useState(initialTasks)
  const [rotOpen, setRotOpen] = React.useState(false)
  const [planFor, setPlanFor] = React.useState<{
    prospectId: string
    name: string
    stage: string
    completeTaskId: string | null
  } | null>(null)

  React.useEffect(() => setTasks(initialTasks), [initialTasks])

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const overdue = tasks.filter((task) => new Date(task.due_at) < startOfToday)
  const today = tasks.filter((task) => new Date(task.due_at) >= startOfToday)
  const signals = React.useMemo(() => computeSignals(leads), [leads])
  const rotting = React.useMemo(
    () =>
      leads.filter((lead) => {
        const rot = rottingFor(lead.status as ProspectStatus, lead.last_activity_at)
        return rot.level !== "fresh" || !lead.open_task
      }),
    [leads]
  )

  const dateLabel = new Date().toLocaleDateString("no-NO", {
    weekday: "long",
    day: "numeric",
    month: "long",
  })

  return (
    <SelgerPageShell segments={["Selger", "I dag"]}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-4 pb-10">
        <div className="flex items-end justify-between gap-3 pb-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">I dag</h1>
            <p className="text-xs text-muted-foreground">
              {overdue.length} forfalte · {today.length} {today.length === 1 ? "oppgave" : "oppgaver"} i dag ·{" "}
              {signals.length} nye signaler
            </p>
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {dateLabel}
          </span>
        </div>

        {tasks.length === 0 && signals.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <CheckCircle2Icon className="mx-auto size-8 text-lime-600" />
            <p className="mt-2 font-semibold">Alt gjort for i dag</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ingen forfalte oppgaver. Vil du jobbe fremover?
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/selger/pipeline">Åpne pipeline</Link>
              </Button>
              <Button asChild size="sm">
                <Link href="/selger/leads">Kvalifiser nye leads</Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            {overdue.length > 0 && (
              <Section label="Forfalt" count={overdue.length} tone="danger">
                <div className="divide-y divide-amber-200/70 rounded-lg border border-amber-200 bg-amber-50/50 dark:divide-amber-900 dark:border-amber-900 dark:bg-amber-950/30">
                  {overdue.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onComplete={() =>
                        setPlanFor({
                          prospectId: task.prospect_id,
                          name: task.prospect.name,
                          stage: task.prospect.status,
                          completeTaskId: task.id,
                        })
                      }
                    />
                  ))}
                </div>
              </Section>
            )}

            {today.length > 0 && (
              <Section label="I dag" count={today.length}>
                <div className="divide-y rounded-lg border bg-card">
                  {today.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      onComplete={() =>
                        setPlanFor({
                          prospectId: task.prospect_id,
                          name: task.prospect.name,
                          stage: task.prospect.status,
                          completeTaskId: task.id,
                        })
                      }
                    />
                  ))}
                </div>
              </Section>
            )}

            {signals.length > 0 && (
              <Section label="Nye signaler" count={signals.length} tone="success">
                <div className="divide-y rounded-lg border bg-card">
                  {signals.map((signal) => (
                    <div key={signal.id} className="flex items-center gap-3 px-3.5 py-3">
                      <span
                        className={cn(
                          "size-2 shrink-0 rounded-full",
                          signal.hot ? "bg-orange-500" : "bg-lime-500"
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-semibold">
                          <span className="truncate">{signal.title}</span>
                          {signal.hot && <FlameIcon className="size-3.5 shrink-0 text-orange-500" />}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{signal.description}</p>
                      </div>
                      <Button asChild size="sm" variant="outline" className="h-7 shrink-0 text-xs">
                        <Link href={`/selger/leads/${signal.leadId}`}>{signal.action}</Link>
                      </Button>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {rotting.length > 0 && (
              <div className="mt-4 overflow-hidden rounded-lg border bg-card">
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3.5 py-3 text-sm font-semibold"
                  onClick={() => setRotOpen((v) => !v)}
                >
                  <AlertTriangleIcon className="size-4 text-amber-600" />
                  Råtner — trenger et dytt
                  <span className="rounded-full border bg-secondary px-2 py-0.5 text-[11px] font-bold">
                    {rotting.length}
                  </span>
                  <ChevronDownIcon
                    className={cn("ml-auto size-4 text-muted-foreground transition-transform", rotOpen && "rotate-180")}
                  />
                </button>
                {rotOpen && (
                  <div className="divide-y border-t">
                    {rotting.map((lead) => {
                      const rot = rottingFor(lead.status as ProspectStatus, lead.last_activity_at)
                      return (
                        <div key={lead.id} className="flex items-center gap-3 px-3.5 py-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                              <Link href={`/selger/leads/${lead.id}`} className="truncate hover:underline">
                                {lead.name}
                              </Link>
                              <Badge
                                variant="outline"
                                className={cn("text-[9px]", STAGE_CHIP[lead.status])}
                              >
                                {(PROSPECT_STATUS_LABELS as Record<string, string>)[lead.status] ?? lead.status}
                              </Badge>
                              {rot.level !== "fresh" && (
                                <Badge variant="outline" className="theme-badge-status-sent text-[9px]">
                                  {rot.days} d uten aktivitet
                                </Badge>
                              )}
                            </p>
                            {!lead.open_task && (
                              <p className="text-xs text-muted-foreground">Ingen neste handling planlagt</p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 text-xs"
                            onClick={() =>
                              setPlanFor({
                                prospectId: lead.id,
                                name: lead.name,
                                stage: lead.status,
                                completeTaskId: null,
                              })
                            }
                          >
                            Planlegg neste
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {planFor && (
        <PlanNextDialog
          open={Boolean(planFor)}
          onOpenChange={(open) => !open && setPlanFor(null)}
          prospectId={planFor.prospectId}
          prospectName={planFor.name}
          stage={planFor.stage}
          completeTaskId={planFor.completeTaskId}
          onSaved={() => {
            if (planFor.completeTaskId) {
              setTasks((prev) => prev.filter((task) => task.id !== planFor.completeTaskId))
            }
            setPlanFor(null)
            router.refresh()
          }}
        />
      )}
    </SelgerPageShell>
  )
}

function Section({
  label,
  count,
  tone,
  children,
}: {
  label: string
  count: number
  tone?: "danger" | "success"
  children: React.ReactNode
}) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={cn(
            "text-[10px] font-semibold uppercase tracking-[0.2em]",
            tone === "danger"
              ? "text-red-700 dark:text-red-400"
              : tone === "success"
                ? "text-lime-700 dark:text-lime-400"
                : "text-muted-foreground"
          )}
        >
          {label}
        </span>
        <span className="rounded-full border bg-secondary px-1.5 text-[10px] font-bold text-foreground/70">
          {count}
        </span>
      </div>
      {children}
    </div>
  )
}

function TaskRow({ task, onComplete }: { task: TaskWithLead; onComplete: () => void }) {
  const due = dueLabel(task.due_at)
  const timePart = new Date(task.due_at).toLocaleTimeString("no-NO", {
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className="group flex items-center gap-3 px-3.5 py-3">
      <button
        type="button"
        onClick={onComplete}
        aria-label="Fullfør oppgave"
        className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-border text-transparent transition-colors hover:border-lime-600 hover:bg-accent hover:text-accent-foreground"
      >
        <CheckIcon className="size-3.5" strokeWidth={3} />
      </button>
      <span className="flex size-7 shrink-0 items-center justify-center rounded border bg-secondary text-muted-foreground">
        {TASK_ICONS[task.task_type]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <Link
            href={`/selger/leads/${task.prospect.id}`}
            className="truncate text-sm font-semibold hover:underline"
          >
            {task.prospect.name}
          </Link>
          <Badge variant="outline" className={cn("text-[9px]", STAGE_CHIP[task.prospect.status])}>
            {(PROSPECT_STATUS_LABELS as Record<string, string>)[task.prospect.status] ??
              task.prospect.status}
          </Badge>
        </p>
        <p className="truncate text-xs text-muted-foreground">{task.title || "Neste handling"}</p>
      </div>
      <span
        className={cn(
          "shrink-0 text-[11px] font-semibold",
          due.overdue ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {due.overdue ? due.text : due.text === "i dag" ? `i dag ${timePart}` : due.text}
      </span>
      <div className="flex shrink-0 gap-1">
        {task.prospect.phone && (
          <Button asChild size="sm" variant="ghost" className="size-7 p-0" title="Ring">
            <a href={`tel:${task.prospect.phone.replace(/\s/g, "")}`}>
              <PhoneIcon className="size-3.5" />
            </a>
          </Button>
        )}
        {task.prospect.email && (
          <Button asChild size="sm" variant="ghost" className="size-7 p-0" title="Send e-post">
            <Link href={`/selger/leads/${task.prospect.id}?composer=epost`}>
              <MailIcon className="size-3.5" />
            </Link>
          </Button>
        )}
        <Button asChild size="sm" variant="ghost" className="size-7 p-0" title="Åpne">
          <Link href={`/selger/leads/${task.prospect.id}`}>
            <ChevronRightIcon className="size-4" />
          </Link>
        </Button>
      </div>
    </div>
  )
}
