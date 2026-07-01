"use client"

import Link from "next/link"
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Mail,
  Phone,
  Plus,
  Users,
} from "lucide-react"

import { DeviationListItem } from "@/components/hms/deviation-badges"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DeviationWithRelations } from "@/lib/hms/types"
import type { ChecklistSummary } from "@/lib/ks/types"
import { formatHours } from "@/lib/time-tracking"
import { cn } from "@/lib/utils"
import {
  formatProjectDate,
  getProjectPeriod,
  getStatusConfig,
  getTimelineProgress,
  formatDaysRemaining,
  isPastDeadline,
} from "@/app/prosjekter/project-utils"

import { ProjectPhaseControl } from "./project-phase-control"
import { useProjectTabNavigation } from "./project-tabs-shell"

const statusToLabel: Record<string, string> = {
  todo: "Ikke startet",
  in_progress: "Pågår",
  review: "Til gjennomgang",
  done: "Ferdig",
}

const priorityToLabel: Record<string, string> = {
  low: "Lav",
  medium: "Medium",
  high: "Høy",
  urgent: "Kritisk",
}

const priorityBadgeClass: Record<string, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  urgent: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
}

export type OverviewTask = {
  id: string
  title: string
  status: string | null
  priority: string | null
  due_date: string | null
  assigned_to: string | null
  assigneeName: string | null
}

export type OverviewParticipant = {
  id: string
  name: string
  email: string
  avatar: string
}

export type ParticipantHoursSummary = {
  userId: string
  name: string
  totalHours: number
}

export type ProjectOverviewProps = {
  projectId: string
  project: {
    status: string | null
    description: string | null
    budget_nok: number | null
    start_date: string | null
    end_date: string | null
  }
  customer: {
    name: string
    email: string | null
    phone: string | null
  }
  tasks: OverviewTask[]
  deviations: DeviationWithRelations[]
  checklists: ChecklistSummary[]
  participants: OverviewParticipant[]
  participantHours: ParticipantHoursSummary[]
  offersSummary: {
    total: number
    accepted: number
    sent: number
    acceptancePercent: number
  }
  metrics: {
    progressPercent: number
    doneTasks: number
    totalTasks: number
    openTasks: number
    overdueTasks: number
    totalHours: number
  }
  flags: {
    isWorker: boolean
    isProjectAdmin: boolean
    hasTimeforing: boolean
    hasKs: boolean
  }
}

function sortTasksForPreview(tasks: OverviewTask[]) {
  const now = new Date()
  return [...tasks]
    .filter((task) => task.status !== "done")
    .sort((a, b) => {
      const aOverdue = Boolean(a.due_date && new Date(a.due_date) < now)
      const bOverdue = Boolean(b.due_date && new Date(b.due_date) < now)
      if (aOverdue && !bOverdue) return -1
      if (!aOverdue && bOverdue) return 1
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      }
      if (a.due_date) return -1
      if (b.due_date) return 1
      return 0
    })
}

function formatDueDate(value: string | null) {
  if (!value) return "Ingen frist"
  const date = new Date(value)
  const now = new Date()
  const isOverdue = date < now
  const label = date.toLocaleDateString("no-NO", { day: "numeric", month: "short" })
  return isOverdue ? `Forfalt ${label}` : label
}

function formatNok(value: number) {
  return new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value)
}

function OverviewStat({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold tabular-nums leading-none",
          highlight ? "text-destructive" : "text-foreground"
        )}
      >
        {value}
      </p>
    </div>
  )
}

export function ProjectOverviewTab({
  projectId,
  project,
  customer,
  tasks,
  deviations,
  checklists,
  participants,
  participantHours,
  offersSummary,
  metrics,
  flags,
}: ProjectOverviewProps) {
  const navigateToTab = useProjectTabNavigation()
  const statusConfig = getStatusConfig(project.status)
  const openDeviations = deviations.filter((d) => d.status === "open")
  const activeChecklists = checklists.filter(
    (c) => c.status === "in_progress" || c.status === "not_started"
  )
  const ksOpenDeviations = openDeviations.filter((d) => d.type === "ks")
  const overdueTaskList = tasks.filter((task) => {
    if (!task.due_date || task.status === "done") return false
    return new Date(task.due_date) < new Date()
  })
  const upcomingTasks = sortTasksForPreview(tasks).slice(0, 5)
  const timelinePercent = getTimelineProgress(project.start_date, project.end_date)
  const pastDeadline = isPastDeadline(project.end_date, project.status)
  const hasAttentionItems =
    overdueTaskList.length > 0 ||
    openDeviations.length > 0 ||
    activeChecklists.length > 0 ||
    pastDeadline

  const topHours = [...participantHours]
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 3)

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      {/* KPI rail */}
      <Card
        className={cn(
          "overflow-hidden rounded-lg border-l-4 lg:col-span-12",
          statusConfig.railBorderClass
        )}
      >
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center">
          <div className="min-w-[200px] shrink-0 sm:pr-6 sm:border-r sm:border-border/60">
            <ProjectPhaseControl
              projectId={projectId}
              status={project.status}
              canEdit={flags.isProjectAdmin}
            />
          </div>

          <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
            <OverviewStat
              label="Oppgaver ferdig"
              value={
                metrics.totalTasks === 0
                  ? "—"
                  : `${metrics.doneTasks}/${metrics.totalTasks}`
              }
            />
            <OverviewStat
              label="Forfalte"
              value={String(metrics.overdueTasks)}
              highlight={metrics.overdueTasks > 0}
            />
            <OverviewStat
              label="Åpne avvik"
              value={String(openDeviations.length)}
              highlight={openDeviations.length > 0}
            />
            <OverviewStat
              label="KS sjekklister"
              value={String(activeChecklists.length)}
              highlight={activeChecklists.length > 0}
            />
          </div>

          {flags.hasTimeforing && flags.isProjectAdmin && (
            <div className="shrink-0 sm:pl-6 sm:border-l sm:border-border/60">
              <OverviewStat label="Timer" value={formatHours(metrics.totalHours)} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick actions — ryddig 2-kolonners grid på mobil, wrap-rad fra sm */}
      <Card className="rounded-sm lg:col-span-12">
        <CardContent className="grid grid-cols-2 gap-2 px-4 py-3 sm:flex sm:flex-wrap">
          {/* KS-fanen er skjult for workers og uten KS-modul — ikke vis en
              knapp som bare gir en tom fane. */}
          {!flags.isWorker && flags.hasKs && (
            <Button size="sm" variant="outline" onClick={() => navigateToTab("ks")}>
              <ClipboardCheck className="mr-2 h-4 w-4" />
              KS sjekklister
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link href={`/avvik/ny?projectId=${projectId}`}>
              <AlertTriangle className="mr-2 h-4 w-4" />
              Meld avvik
            </Link>
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigateToTab("oppgaver")}>
            <Plus className="mr-2 h-4 w-4" />
            Gå til oppgaver
          </Button>
          {!flags.isWorker && (
            <Button size="sm" variant="outline" asChild>
              <Link href={`/nytt-tilbud?projectId=${projectId}`}>
                <FileText className="mr-2 h-4 w-4" />
                Nytt tilbud
              </Link>
            </Button>
          )}
          {flags.hasTimeforing && (
            <Button size="sm" variant="outline" onClick={() => navigateToTab("timeforing")}>
              <Clock className="mr-2 h-4 w-4" />
              Timeføring
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Attention panel */}
      <Card className="rounded-sm lg:col-span-12">
        <CardHeader className="px-3 pb-1 pt-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            {hasAttentionItems ? (
              <AlertTriangle className="h-4 w-4 text-destructive" />
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            )}
            Krever oppmerksomhet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-3">
          {!hasAttentionItems ? (
            <p className="text-sm text-muted-foreground">
              Alt i orden — ingen forfalte oppgaver, åpne avvik eller ufullstendige sjekklister.
            </p>
          ) : (
            <>
              {pastDeadline && (
                <div className="rounded-sm border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
                  Prosjektet har passert planlagt sluttdato uten å være fullført.
                </div>
              )}
              {activeChecklists.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Ufullstendige sjekklister
                  </p>
                  <ul className="space-y-1">
                    {activeChecklists.slice(0, 3).map((cl) => (
                      <li key={cl.id}>
                        <Link
                          href={`/prosjekter/${projectId}/ks/${cl.id}`}
                          className="flex w-full items-center justify-between rounded-sm border border-muted/60 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/40"
                        >
                          <span className="truncate font-medium">{cl.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {cl.progress.answered}/{cl.progress.total}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ksOpenDeviations.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Åpne KS-avvik ({ksOpenDeviations.length})
                  </p>
                </div>
              )}
              {overdueTaskList.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Forfalte oppgaver
                  </p>
                  <ul className="space-y-1">
                    {overdueTaskList.slice(0, 3).map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => navigateToTab("oppgaver")}
                          className="flex w-full items-center justify-between rounded-sm border border-muted/60 px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/40"
                        >
                          <span className="truncate font-medium">{task.title}</span>
                          <span className="shrink-0 text-xs text-destructive">
                            {formatDueDate(task.due_date)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {openDeviations.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Åpne avvik
                  </p>
                  {openDeviations.slice(0, 2).map((deviation) => (
                    <DeviationListItem
                      key={deviation.id}
                      deviation={deviation}
                      showProject={false}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Upcoming tasks */}
      <Card className="rounded-sm lg:col-span-6">
        <CardHeader className="flex flex-row items-center justify-between px-3 pb-1 pt-3">
          <CardTitle className="text-sm">Neste oppgaver</CardTitle>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => navigateToTab("oppgaver")}
          >
            Se alle
          </Button>
        </CardHeader>
        <CardContent className="px-3 pb-3">
          {upcomingTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen åpne oppgaver.</p>
          ) : (
            <ul className="space-y-2">
              {upcomingTasks.map((task) => {
                const isOverdue = Boolean(
                  task.due_date && new Date(task.due_date) < new Date()
                )
                return (
                  <li
                    key={task.id}
                    className="rounded-sm border border-muted/60 px-2 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{task.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {task.assigneeName || "Ikke tildelt"} ·{" "}
                          {statusToLabel[task.status || "todo"]}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {task.priority && (
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-[10px]",
                              priorityBadgeClass[task.priority]
                            )}
                          >
                            {priorityToLabel[task.priority]}
                          </Badge>
                        )}
                        <span
                          className={cn(
                            "text-xs",
                            isOverdue ? "text-destructive" : "text-muted-foreground"
                          )}
                        >
                          {formatDueDate(task.due_date)}
                        </span>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Open deviations preview */}
      <Card className="rounded-sm lg:col-span-6">
        <CardHeader className="flex flex-row items-center justify-between px-3 pb-1 pt-3">
          <CardTitle className="text-sm">Avvik</CardTitle>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => navigateToTab("avvik")}
          >
            Se alle
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 px-3 pb-3">
          {openDeviations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen åpne avvik.</p>
          ) : (
            openDeviations.slice(0, 3).map((deviation) => (
              <DeviationListItem
                key={deviation.id}
                deviation={deviation}
                showProject={false}
              />
            ))
          )}
        </CardContent>
      </Card>

      {/* Project info */}
      <Card className="rounded-sm lg:col-span-6">
        <CardHeader className="px-3 pb-1 pt-3">
          <CardTitle className="text-sm">Prosjektinfo</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1.5 px-3 pb-3 text-sm">
          <div className="grid grid-cols-2 gap-1.5">
            <div className="rounded-sm border border-muted/60 px-2 py-1.5">
              <p className="text-xs text-muted-foreground">Kunde</p>
              <p className="truncate text-sm font-semibold text-foreground">{customer.name}</p>
            </div>
            <div className="rounded-sm border border-muted/60 px-2 py-1.5">
              <p className="text-xs text-muted-foreground">Periode</p>
              <p className="text-sm font-semibold text-foreground">
                {getProjectPeriod(project)}
              </p>
            </div>
            {!flags.isWorker && (
              <>
                <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                  <p className="text-xs text-muted-foreground">Totalramme</p>
                  <p className="text-sm font-semibold text-foreground">
                    {formatNok(project.budget_nok || 0)}
                  </p>
                </div>
                <div className="rounded-sm border border-muted/60 px-2 py-1.5">
                  <p className="text-xs text-muted-foreground">Tilbudsum</p>
                  <p className="text-sm font-semibold text-foreground">
                    {formatNok(offersSummary.total)}
                  </p>
                </div>
              </>
            )}
          </div>

          {(customer.phone || customer.email) && (
            <div className="flex flex-wrap gap-2">
              {customer.phone && (
                <Button size="sm" variant="outline" className="h-8" asChild>
                  <a href={`tel:${customer.phone}`}>
                    <Phone className="mr-2 h-3.5 w-3.5" />
                    Ring
                  </a>
                </Button>
              )}
              {customer.email && (
                <Button size="sm" variant="outline" className="h-8" asChild>
                  <a href={`mailto:${customer.email}`}>
                    <Mail className="mr-2 h-3.5 w-3.5" />
                    E-post
                  </a>
                </Button>
              )}
            </div>
          )}

          {project.start_date && project.end_date && (
            <div className="rounded-sm border border-muted/60 px-2 py-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatProjectDate(project.start_date)}
                </span>
                <span>I dag</span>
                <span>{formatProjectDate(project.end_date)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full theme-progress-fill-planning"
                  style={{ width: `${timelinePercent}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {timelinePercent}% av planlagt periode er brukt
              </p>
            </div>
          )}

          {project.description?.trim() && (
            <div className="rounded-sm border border-muted/60 px-2 py-1.5">
              <p className="text-xs text-muted-foreground">Beskrivelse</p>
              <p className="line-clamp-3 text-sm text-foreground">{project.description}</p>
            </div>
          )}

          {!flags.isWorker && (
            <div className="rounded-sm border border-muted/60 px-2 py-1.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Tilbudsstatus</span>
                <span className="font-medium text-foreground">
                  {offersSummary.acceptancePercent}% godkjent
                </span>
              </div>
              <div className="mt-1 flex h-2.5 overflow-hidden rounded-sm bg-muted">
                <span
                  className="theme-progress-fill-completed"
                  style={{ width: `${Math.min(100, offersSummary.acceptancePercent)}%` }}
                />
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>Godkjent: {offersSummary.accepted}</span>
                <span>Sendt: {offersSummary.sent}</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Team snapshot */}
      <Card className="rounded-sm lg:col-span-6">
        <CardHeader className="flex flex-row items-center justify-between px-3 pb-1 pt-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4" />
            Team ({participants.length})
          </CardTitle>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs"
            onClick={() => navigateToTab("deltakere")}
          >
            Se alle
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 px-3 pb-3">
          <div className="flex flex-wrap gap-2">
            {participants.slice(0, 8).map((participant) => (
              <div
                key={participant.id}
                className="flex items-center gap-2 rounded-sm border border-muted/60 px-2 py-1.5"
              >
                <Avatar className="h-7 w-7">
                  <AvatarFallback className="bg-primary/10 text-primary text-[10px]">
                    {participant.avatar}
                  </AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium">{participant.name}</span>
              </div>
            ))}
          </div>

          {flags.hasTimeforing && flags.isProjectAdmin && topHours.length > 0 && (
            <div className="space-y-1.5 border-t pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Mest timer
              </p>
              {topHours.map((entry) => (
                <div
                  key={entry.userId}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{entry.name}</span>
                  <span className="font-medium tabular-nums">{formatHours(entry.totalHours)}</span>
                </div>
              ))}
            </div>
          )}

          {flags.hasTimeforing && (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              onClick={() => navigateToTab("timeforing")}
            >
              <Clock className="mr-2 h-4 w-4" />
              Gå til timeføring
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
