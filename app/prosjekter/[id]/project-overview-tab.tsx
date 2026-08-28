"use client"

import Link from "next/link"
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  FileText,
  Mail,
  Phone,
  TrendingUp,
  Users,
} from "lucide-react"

import { formatMarginPct } from "@/lib/job-costing/format"
import type { ProjectProfitability } from "@/lib/job-costing/types"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { DeviationWithRelations } from "@/lib/hms/types"
import type { ChecklistSummary } from "@/lib/ks/types"
import { formatHours } from "@/lib/time-tracking"
import { cn } from "@/lib/utils"
import {
  formatProjectDate,
  getProjectPeriod,
  getTimelineProgress,
  isPastDeadline,
} from "@/app/prosjekter/project-utils"

import { useProjectTabNavigation } from "./project-tabs-shell"

/**
 * Prosjektets Oversikt.
 *
 * REKKEFØLGEN ER MÅLT, IKKE GJETTET. PostHog, siste 90 dager på app-domenene:
 * /prosjekter/:id er appens mest besøkte side (234 visninger). Innenfor
 * prosjektet er fanebruken:
 *
 *   Oversikt 57 · Tilbud 45 · Lønnsomhet 32 · Kjørebok 16 ·
 *   Etterfakturering 16 · Oppgaver 15 · 3D 15 · Timeføring 14 ·
 *   KS 10 · Filer 10 · Avvik 5
 *
 * Altså: etter Oversikt handler de to mest brukte fanene om PENGER. Den gamle
 * Oversikten ledet med fire tellere for oppgaver, avvik og sjekklister — de
 * minst brukte områdene — og gjemte lønnsomheten som et lite utdrag i midten.
 * Den rekkefølgen er snudd her.
 *
 * (Tallene er tynne: fire personer, og noen av dem er våre egne. De sier hva
 * folk faktisk åpner, ikke hva som er viktigst i teorien. Endrer bruken seg,
 * endre rekkefølgen — men ikke bytt den ut med en magefølelse.)
 *
 * Det gamle bildet fortalte i tillegg de samme fire tallene tre ganger (KPI-rad,
 * «Krever oppmerksomhet» og egne kort), og hadde en rad hurtigknapper som
 * duplikerte fanene rett over. Begge deler er borte.
 */
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
  /** Utdraget av lønnsomheten. `null` for håndverkere, som ikke ser tallene. */
  profitability: ProjectProfitability | null
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

function formatNok(value: number) {
  return new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDueDate(value: string | null) {
  if (!value) return "Ingen frist"
  const date = new Date(value)
  const label = date.toLocaleDateString("no-NO", { day: "numeric", month: "short" })
  return date < new Date() ? `Forfalt ${label}` : label
}

/** Én rad = én ting som står stille, og én knapp som gjør noe med den. */
type AttentionRow = {
  key: string
  title: string
  meta: string
  action: string
  onAction: () => void
  tone: "danger" | "warning"
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: "positive" | "negative"
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-lg font-semibold leading-none tabular-nums",
          tone === "positive" && "text-emerald-600",
          tone === "negative" && "text-destructive",
          !tone && "text-foreground"
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
  profitability,
  metrics,
  flags,
}: ProjectOverviewProps) {
  const navigateToTab = useProjectTabNavigation()

  const openDeviations = deviations.filter((d) => d.status === "open")
  const activeChecklists = checklists.filter(
    (c) => c.status === "in_progress" || c.status === "not_started"
  )
  const overdueTasks = tasks.filter((task) => {
    if (!task.due_date || task.status === "done") return false
    return new Date(task.due_date) < new Date()
  })
  const nextTasks = [...tasks]
    .filter((task) => task.status !== "done")
    .sort((a, b) => {
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      }
      if (a.due_date) return -1
      if (b.due_date) return 1
      return 0
    })
    .slice(0, 3)

  const timelinePercent = getTimelineProgress(project.start_date, project.end_date)
  const pastDeadline = isPastDeadline(project.end_date, project.status)
  const topHours = [...participantHours]
    .sort((a, b) => b.totalHours - a.totalHours)
    .slice(0, 3)

  // Tellere er ikke handlinger. Hver rad her har én knapp, og lista er tom når
  // det ikke er noe å gjøre — i stedet for å vise fire nuller.
  const attention: AttentionRow[] = []
  if (pastDeadline) {
    attention.push({
      key: "deadline",
      tone: "danger",
      title: "Prosjektet er over sluttdatoen",
      meta: `Frist var ${formatProjectDate(project.end_date)}`,
      action: "Se oppgavene",
      onAction: () => navigateToTab("oppgaver"),
    })
  }
  if (overdueTasks.length > 0) {
    attention.push({
      key: "tasks",
      tone: "danger",
      title:
        overdueTasks.length === 1
          ? `«${overdueTasks[0].title}» er over fristen`
          : `${overdueTasks.length} oppgaver er over fristen`,
      meta: `Eldste: ${formatDueDate(overdueTasks[0].due_date)}`,
      action: "Åpne oppgavene",
      onAction: () => navigateToTab("oppgaver"),
    })
  }
  if (openDeviations.length > 0) {
    attention.push({
      key: "deviations",
      tone: "warning",
      title: `${openDeviations.length} ${openDeviations.length === 1 ? "avvik er" : "avvik er"} åpne`,
      meta: openDeviations[0]?.title ?? "Lukkes med tiltak og dokumentasjon",
      action: "Se avvikene",
      onAction: () => navigateToTab("avvik"),
    })
  }
  if (flags.hasKs && !flags.isWorker && activeChecklists.length > 0) {
    attention.push({
      key: "checklists",
      tone: "warning",
      title: `${activeChecklists.length} sjekklister er ikke fullført`,
      meta: "Dokumentasjonen mangler før overlevering",
      action: "Åpne KS",
      onAction: () => navigateToTab("ks"),
    })
  }

  return (
    <div className="grid gap-3 lg:grid-cols-12">
      {/* 1 — Det som står stille. Vises bare når det finnes noe. */}
      {attention.length > 0 ? (
        <Card className="overflow-hidden lg:col-span-12">
          <CardHeader className="px-4 pb-2 pt-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertTriangle className="size-4 text-[color:var(--tone-warning)]" />
              Krever oppmerksomhet
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y border-t">
              {attention.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap"
                >
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]"
                    style={{
                      background:
                        row.tone === "danger"
                          ? "var(--overlay-danger)"
                          : "var(--overlay-warning)",
                    }}
                  >
                    <AlertTriangle
                      className="size-4"
                      style={{
                        color:
                          row.tone === "danger"
                            ? "var(--tone-danger)"
                            : "var(--tone-warning)",
                      }}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{row.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.meta}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" className="shrink-0" onClick={row.onAction}>
                    {row.action}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : (
        <Card className="lg:col-span-12">
          <CardContent className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 text-emerald-600" />
            Alt i orden — ingen forfalte oppgaver, åpne avvik eller ufullstendige sjekklister.
          </CardContent>
        </Card>
      )}

      {/* 2 — Penger. Lønnsomhet er den nest mest brukte fanen; da skal svaret
             stå her, ikke gjemmes i et utdrag lenger nede. */}
      {!flags.isWorker && profitability && (
        <ProfitabilityCard
          profitability={profitability}
          budgetNok={project.budget_nok}
          onOpen={() => navigateToTab("lonnsomhet")}
        />
      )}

      {/* 3 — Tilbud: den mest brukte fanen etter Oversikt. */}
      {!flags.isWorker && (
        <Card className="lg:col-span-4">
          <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <FileText className="size-4" />
              Tilbud
            </CardTitle>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => navigateToTab("tilbud")}
            >
              Se alle
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 px-4 pb-4">
            <Stat label="Sum tilbud" value={formatNok(offersSummary.total)} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Godkjent</span>
              <span className="font-semibold tabular-nums">
                {offersSummary.accepted} av {offersSummary.accepted + offersSummary.sent}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full bg-primary"
                style={{ width: `${Math.min(100, offersSummary.acceptancePercent)}%` }}
              />
            </div>
            <Button size="sm" variant="outline" className="w-full" asChild>
              <Link href={`/nytt-tilbud?projectId=${projectId}`}>Nytt tilbud</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 4 — Fremdrift: arbeid og tid i samme bilde. */}
      <Card className={cn("lg:col-span-8", flags.isWorker && "lg:col-span-12")}>
        <CardHeader className="px-4 pb-2 pt-3">
          <CardTitle className="text-sm">Slik ligger vi an</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-4 pb-4">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Stat
              label="Oppgaver"
              value={
                metrics.totalTasks === 0
                  ? "—"
                  : `${metrics.doneTasks} av ${metrics.totalTasks}`
              }
            />
            {flags.hasTimeforing && (
              <Stat label="Timer ført" value={formatHours(metrics.totalHours)} />
            )}
            <Stat
              label="Over fristen"
              value={String(metrics.overdueTasks)}
              tone={metrics.overdueTasks > 0 ? "negative" : undefined}
            />
          </div>

          {metrics.totalTasks > 0 && (
            <div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full bg-primary"
                  style={{ width: `${metrics.progressPercent}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {metrics.progressPercent} % av oppgavene er ferdige
              </p>
            </div>
          )}

          {project.start_date && project.end_date && (
            <div className="border-t pt-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Calendar className="size-3.5" />
                  {formatProjectDate(project.start_date)}
                </span>
                <span>{formatProjectDate(project.end_date)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "block h-full",
                    pastDeadline ? "bg-destructive" : "bg-accent"
                  )}
                  style={{ width: `${timelinePercent}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {timelinePercent} % av planlagt periode er brukt
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5 — Hva står for tur. */}
      <Card className="lg:col-span-4">
        <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-3">
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
        <CardContent className="px-4 pb-4">
          {nextTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen åpne oppgaver.</p>
          ) : (
            <ul className="space-y-2.5">
              {nextTasks.map((task) => (
                <li key={task.id} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{task.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {task.assigneeName ?? "Ikke tildelt"}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-xs tabular-nums",
                      task.due_date && new Date(task.due_date) < new Date()
                        ? "font-semibold text-destructive"
                        : "text-muted-foreground"
                    )}
                  >
                    {formatDueDate(task.due_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 6 — Folk. */}
      <Card className="lg:col-span-8">
        <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="size-4" />
            På jobben ({participants.length})
          </CardTitle>
          {!flags.isWorker && (
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              onClick={() => navigateToTab("deltakere")}
            >
              Se alle
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          {participants.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ingen er lagt til på prosjektet ennå.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {participants.slice(0, 8).map((participant) => (
                <span
                  key={participant.id}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border px-2 py-1.5"
                >
                  <Avatar className="size-6">
                    <AvatarFallback className="bg-primary/10 text-[10px] text-primary">
                      {participant.avatar}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium">{participant.name}</span>
                </span>
              ))}
            </div>
          )}

          {flags.hasTimeforing && flags.isProjectAdmin && topHours.length > 0 && (
            <div className="space-y-1.5 border-t pt-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Mest timer
              </p>
              {topHours.map((entry) => (
                <div key={entry.userId} className="flex items-center justify-between text-sm">
                  <span>{entry.name}</span>
                  <span className="font-medium tabular-nums">{formatHours(entry.totalHours)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* 7 — Kunden og avtalen. */}
      <Card className="lg:col-span-4">
        <CardHeader className="px-4 pb-2 pt-3">
          <CardTitle className="text-sm">Kunde og avtale</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4 pb-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Kunde
            </p>
            <p className="truncate text-sm font-semibold">{customer.name}</p>
          </div>

          {(customer.phone || customer.email) && (
            <div className="flex flex-wrap gap-2">
              {customer.phone && (
                <Button size="sm" variant="outline" asChild>
                  <a href={`tel:${customer.phone}`}>
                    <Phone className="size-3.5" />
                    Ring
                  </a>
                </Button>
              )}
              {customer.email && (
                <Button size="sm" variant="outline" asChild>
                  <a href={`mailto:${customer.email}`}>
                    <Mail className="size-3.5" />
                    E-post
                  </a>
                </Button>
              )}
            </div>
          )}

          <div className="space-y-1 border-t pt-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Periode</span>
              <span className="font-medium">{getProjectPeriod(project)}</span>
            </div>
            {!flags.isWorker && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Totalramme</span>
                <span className="font-medium tabular-nums">
                  {formatNok(project.budget_nok || 0)}
                </span>
              </div>
            )}
          </div>

          {project.description?.trim() && (
            <p className="line-clamp-4 border-t pt-3 text-sm text-muted-foreground">
              {project.description}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Lønnsomheten, som ledende kort. Fire tall og én linje: tjener jobben penger,
 * og hvor mye av omsetningen er allerede brukt. Detaljene hører hjemme på
 * Lønnsomhet-fanen.
 */
function ProfitabilityCard({
  profitability,
  budgetNok,
  onOpen,
}: {
  profitability: ProjectProfitability
  budgetNok: number | null
  onOpen: () => void
}) {
  const { actual, revenueNok } = profitability
  const marginPositive = actual.marginNok >= 0
  const hasRevenue = revenueNok > 0
  const costShare =
    revenueNok > 0 ? Math.min(100, Math.round((actual.totalCostNok / revenueNok) * 100)) : 0

  return (
    <Card className="lg:col-span-8">
      <CardHeader className="flex flex-row items-center justify-between px-4 pb-2 pt-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="size-4" />
          Tjener vi penger?
        </CardTitle>
        <Button variant="link" size="sm" className="h-auto gap-1 p-0 text-xs" onClick={onOpen}>
          Se lønnsomhet
          <ArrowRight className="size-3" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Dekningsbidrag
            </p>
            <p
              className={cn(
                "mt-1 text-3xl font-bold tracking-tight tabular-nums",
                marginPositive ? "text-emerald-600" : "text-destructive"
              )}
            >
              {formatNok(actual.marginNok)}
            </p>
          </div>
          <Stat
            label="Dekningsgrad"
            value={formatMarginPct(actual.marginPct)}
            tone={
              actual.marginPct === null ? undefined : marginPositive ? "positive" : "negative"
            }
          />
          <Stat label="Omsetning" value={formatNok(revenueNok)} />
          <Stat label="Kostnad hittil" value={formatNok(actual.totalCostNok)} />
          {budgetNok ? <Stat label="Budsjett" value={formatNok(budgetNok)} /> : null}
        </div>

        {hasRevenue ? (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-emerald-600/20">
              <span
                className={cn(
                  "block h-full",
                  marginPositive ? "bg-foreground/70" : "bg-destructive"
                )}
                style={{ width: `${costShare}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              {costShare} % av omsetningen er brukt på lønn og materialer
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Omsetningen teller først når et tilbud er akseptert på prosjektet.
          </p>
        )}

        {profitability.costRateNok === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-[color:var(--tone-warning-strong)]">
            <ClipboardCheck className="size-3.5" />
            Lønnskost mangler: ingen av timeprisene dine har kostpris (kr/t).
          </p>
        )}
      </CardContent>
    </Card>
  )
}
