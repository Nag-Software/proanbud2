"use client"

import {
  AlertTriangle,
  ArrowRight,
  Box,
  Calendar,
  CheckCircle2,
  ClipboardCheck,
  ListTodo,
  Mail,
  Phone,
  Send,
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

import { avatarTint } from "./project-people-sheet"
import { useProjectPeopleSheet, useProjectTabNavigation } from "./project-tabs-shell"

/**
 * Prosjektets Oversikt, for ledere. Håndverkeren starter på «I dag».
 *
 * REKKEFØLGEN ER MÅLT, IKKE GJETTET. PostHog, siste 90 dager på app-domenene:
 * /prosjekter/:id er appens mest besøkte side (234 visninger). Innenfor
 * prosjektet var fanebruken:
 *
 *   Oversikt 57 · Tilbud 45 · Lønnsomhet 32 · Kjørebok 16 ·
 *   Etterfakturering 16 · Oppgaver 15 · 3D 15 · Timeføring 14 ·
 *   KS 10 · Filer 10 · Avvik 5
 *
 * Altså: etter Oversikt handler de mest brukte fanene om PENGER. Derfor står
 * pengeflyten (tilbud → tillegg → kostnad → dekningsbidrag) rett under det
 * som venter, og oppgaver og fremdrift etter.
 *
 * (Tallene er tynne: fire personer, og noen av dem er våre egne. De sier hva
 * folk faktisk åpner, ikke hva som er viktigst i teorien. Endrer bruken seg,
 * endre rekkefølgen — men ikke bytt den ut med en magefølelse.)
 *
 * «Venter på deg» viser bare ting som står stille, hver med én knapp. Er det
 * ingenting, er det en kompakt linje i stedet for et kort med nuller.
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
  accessLevel?: string
}

export type ParticipantHoursSummary = {
  userId: string
  name: string
  totalHours: number
}

export type ChangeOrderSummary = {
  acceptedNok: number
  acceptedCount: number
  /** Sendt til kunden og ikke besvart. */
  pending: Array<{ id: string; title: string; amountNok: number; sentAt: string | null }>
}

export type ProjectOverviewProps = {
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
  }
  changeOrders: ChangeOrderSummary
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
    isProjectAdmin: boolean
    hasTimeforing: boolean
    hasKs: boolean
    hasTasks: boolean
  }
}

function formatNok(value: number) {
  return new Intl.NumberFormat("no-NO", {
    style: "currency",
    currency: "NOK",
    maximumFractionDigits: 0,
  }).format(value)
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("no-NO", { maximumFractionDigits: 0 }).format(value)
}

function formatDueDate(value: string | null) {
  if (!value) return "Ingen frist"
  const date = new Date(value)
  const label = date.toLocaleDateString("no-NO", { day: "numeric", month: "short" })
  return date < new Date() ? `Forfalt ${label}` : label
}

function daysSince(value: string | null) {
  if (!value) return null
  return Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
}

/** Én rad = én ting som står stille, og én knapp som gjør noe med den. */
type AttentionRow = {
  key: string
  title: string
  meta: string
  action: string
  onAction: () => void
  tone: "danger" | "warning" | "info"
  icon: typeof AlertTriangle
}

/** Et tilbud som er sendt og ikke besvart på så mange dager, bør purres. */
const CHANGE_ORDER_NUDGE_DAYS = 3

export function ProjectOverviewTab({
  project,
  customer,
  tasks,
  deviations,
  checklists,
  participants,
  participantHours,
  offersSummary,
  changeOrders,
  profitability,
  metrics,
  flags,
}: ProjectOverviewProps) {
  const navigateToTab = useProjectTabNavigation()
  const [, setPeopleOpen] = useProjectPeopleSheet()

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
  const hoursById = new Map(participantHours.map((entry) => [entry.userId, entry.totalHours]))
  const showHours = flags.hasTimeforing && flags.isProjectAdmin && participantHours.length > 0

  const staleChangeOrders = changeOrders.pending.filter(
    (order) => (daysSince(order.sentAt) ?? 0) >= CHANGE_ORDER_NUDGE_DAYS
  )

  const attention: AttentionRow[] = []
  if (staleChangeOrders.length > 0) {
    const oldest = staleChangeOrders.reduce((a, b) =>
      (daysSince(a.sentAt) ?? 0) >= (daysSince(b.sentAt) ?? 0) ? a : b
    )
    attention.push({
      key: "change-orders",
      tone: "warning",
      icon: Send,
      title:
        staleChangeOrders.length === 1
          ? `Ekstrajobb «${oldest.title}» venter på kundens svar`
          : `${staleChangeOrders.length} ekstrajobber venter på kundens svar`,
      meta: `${formatNok(oldest.amountNok)} · ${daysSince(oldest.sentAt)} dager uten svar`,
      action: "Se ekstrajobben",
      onAction: () => navigateToTab("okonomi", "tilleggsarbeid"),
    })
  }
  if (openDeviations.length > 0) {
    attention.push({
      key: "deviations",
      tone: "danger",
      icon: AlertTriangle,
      title:
        openDeviations.length === 1
          ? `Avvik: ${openDeviations[0].title}`
          : `${openDeviations.length} avvik er åpne`,
      meta: "Lukkes med tiltak og dokumentasjon",
      action: openDeviations.length === 1 ? "Åpne avviket" : "Se avvikene",
      onAction: () => navigateToTab("kvalitet", "avvik"),
    })
  }
  if (pastDeadline) {
    attention.push({
      key: "deadline",
      tone: "danger",
      icon: Calendar,
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
      icon: ListTodo,
      title:
        overdueTasks.length === 1
          ? `«${overdueTasks[0].title}» er over fristen`
          : `${overdueTasks.length} oppgaver er over fristen`,
      meta: `Eldste: ${formatDueDate(overdueTasks[0].due_date)}`,
      action: "Åpne oppgavene",
      onAction: () => navigateToTab("oppgaver"),
    })
  }
  if (flags.hasKs && activeChecklists.length > 0) {
    attention.push({
      key: "checklists",
      tone: "info",
      icon: ClipboardCheck,
      title:
        activeChecklists.length === 1
          ? `Sjekklista «${activeChecklists[0].name}» er ikke fullført`
          : `${activeChecklists.length} sjekklister er ikke fullført`,
      meta: "Dokumentasjonen mangler før overlevering",
      action: "Åpne",
      onAction: () => navigateToTab("kvalitet", "venter"),
    })
  }

  const toneStyle = {
    danger: { bg: "var(--overlay-danger)", fg: "var(--tone-danger)" },
    warning: { bg: "var(--overlay-warning)", fg: "var(--tone-warning)" },
    info: { bg: "var(--overlay-info)", fg: "var(--tone-info)" },
  } as const

  return (
    <div className="space-y-3">
      {attention.length > 0 ? (
        <Card className="gap-0 overflow-hidden py-0">
          <CardHeader className="flex flex-row items-center justify-between px-4 py-3">
            <CardTitle className="text-sm">Venter på deg</CardTitle>
            <span className="text-xs text-muted-foreground">
              {attention.length} {attention.length === 1 ? "sak" : "saker"}
            </span>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y border-t">
              {attention.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:flex-nowrap"
                >
                  <span
                    className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]"
                    style={{ background: toneStyle[row.tone].bg }}
                  >
                    <row.icon className="size-4" style={{ color: toneStyle[row.tone].fg }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{row.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">{row.meta}</span>
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
        <div className="flex min-h-10 items-center gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
          Ingenting venter på deg. Ingen forfalte oppgaver, åpne avvik eller ubesvarte ekstrajobber.
        </div>
      )}

      {/* Selvstendige kolonner unngår at korte kort strekkes av høyere naboer. */}
      <div className="grid items-start gap-3 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-8">
          <EconomyCard
            profitability={profitability}
            offersSummary={offersSummary}
            changeOrders={changeOrders}
            onOpen={() => navigateToTab("okonomi")}
          />

          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between px-4 py-3">
              <CardTitle className="text-sm">Fremdrift</CardTitle>
              {flags.hasTasks && (
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs"
                  onClick={() => navigateToTab("oppgaver")}
                >
                  {metrics.totalTasks === 0
                    ? "Opprett oppgave"
                    : `${metrics.doneTasks} av ${metrics.totalTasks} oppgaver ferdige`}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-3">
              {nextTasks.length > 0 ? (
                <ul className="divide-y">
                  {nextTasks.map((task) => (
                    <li key={task.id} className="flex items-start justify-between gap-3 py-2 first:pt-0">
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
              ) : (
                <p className="text-sm text-muted-foreground">
                  {metrics.totalTasks > 0
                    ? "Alle oppgavene er ferdige."
                    : "Ingen oppgaver er registrert ennå."}
                </p>
              )}

              {metrics.totalTasks > 0 && (
                <div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
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
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn("block h-full", pastDeadline ? "bg-destructive" : "bg-accent")}
                      style={{ width: `${timelinePercent}%` }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{formatProjectDate(project.start_date)}</span>
                    <span>{timelinePercent} % av perioden brukt</span>
                    <span>{formatProjectDate(project.end_date)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-3 lg:col-span-4">
          <Card className="gap-0 py-0">
            <CardHeader className="px-4 py-3">
              <CardTitle className="text-sm">Kunde</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-3">
              <div>
                <p className="truncate text-sm font-semibold">{customer.name}</p>
                {customer.phone && (
                  <p className="truncate text-xs text-muted-foreground">{customer.phone}</p>
                )}
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
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Periode</span>
                  <span className="text-right font-medium">{getProjectPeriod(project)}</span>
                </div>
                {project.budget_nok ? (
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Totalramme</span>
                    <span className="font-medium tabular-nums">{formatNok(project.budget_nok)}</span>
                  </div>
                ) : null}
              </div>
              {project.description?.trim() && (
                <p className="line-clamp-3 border-t pt-3 text-sm text-muted-foreground">
                  {project.description}
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="flex flex-row items-center justify-between px-4 py-3">
              <CardTitle className="text-sm">På jobben</CardTitle>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-xs"
                onClick={() => setPeopleOpen(true)}
              >
                {participants.length === 0 ? "Legg til" : showHours ? `${formatHours(metrics.totalHours)} ført` : "Se alle"}
              </Button>
            </CardHeader>
            <CardContent className="px-4 pb-3">
              {participants.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ingen er lagt til på prosjektet ennå.</p>
              ) : (
                <ul className="space-y-2">
                  {participants.slice(0, 6).map((participant, index) => (
                    <li key={participant.id} className="flex items-center gap-2 text-sm">
                      <Avatar className="size-6">
                        <AvatarFallback className={cn("text-[9px] font-bold text-foreground", avatarTint(index))}>
                          {participant.avatar}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 truncate">{participant.name}</span>
                      {participant.accessLevel === "Prosjektleder" && (
                        <span className="shrink-0 rounded-full border px-1.5 text-[10px] text-muted-foreground">
                          Leder
                        </span>
                      )}
                      {showHours && (
                        <span className="ml-auto shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatHours(hoursById.get(participant.id) ?? 0)}
                        </span>
                      )}
                    </li>
                  ))}
                  {participants.length > 6 && (
                    <li className="text-xs text-muted-foreground">+{participants.length - 6} til</li>
                  )}
                </ul>
              )}
            </CardContent>
          </Card>

          <button
            type="button"
            onClick={() => navigateToTab("filer", "modell")}
            className="flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors hover:bg-muted/50"
          >
            <Box className="size-4 shrink-0 text-muted-foreground" />
            <span className="flex-1 font-medium">3D-modell</span>
            <ArrowRight className="size-3.5 text-muted-foreground" />
          </button>
        </aside>
      </div>
    </div>
  )
}

/**
 * Pengene fra venstre mot høyre: det kunden har sagt ja til, tilleggene,
 * hva som er brukt, og hva jobben legger igjen. Detaljene står på Økonomi.
 */
function EconomyCard({
  profitability,
  offersSummary,
  changeOrders,
  onOpen,
}: {
  profitability: ProjectProfitability | null
  offersSummary: ProjectOverviewProps["offersSummary"]
  changeOrders: ChangeOrderSummary
  onOpen: () => void
}) {
  const header = (
    <CardHeader className="flex flex-row items-center justify-between px-4 py-3">
      <CardTitle className="text-sm">Økonomi</CardTitle>
      <Button variant="link" size="sm" className="h-auto gap-1 p-0 text-xs" onClick={onOpen}>
        Åpne økonomi
        <ArrowRight className="size-3" />
      </Button>
    </CardHeader>
  )

  if (!profitability || profitability.revenueNok <= 0) {
    return (
      <Card className="gap-0 py-0">
        {header}
        <CardContent className="px-4 pb-3">
          <p className="text-sm font-medium">Lønnsomheten kan ikke beregnes ennå</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {offersSummary.sent > 0
              ? `${offersSummary.sent} tilbud er sendt og venter på svar. Tallene kommer når kunden har sagt ja.`
              : "Tallene kommer når prosjektet har et akseptert tilbud eller fakturerbare timer."}
          </p>
        </CardContent>
      </Card>
    )
  }

  const { actual, planned, revenue } = profitability
  const marginPositive = actual.marginNok >= 0
  const plannedCost = planned?.totalCostNok ?? null
  const costBase = plannedCost && plannedCost > 0 ? plannedCost : profitability.revenueNok
  const costShare = Math.min(100, Math.round((actual.totalCostNok / costBase) * 100))
  const pendingNok = changeOrders.pending.reduce((sum, order) => sum + order.amountNok, 0)

  const tillegg = [
    changeOrders.acceptedCount > 0 ? `${changeOrders.acceptedCount} godkjent` : null,
    changeOrders.pending.length > 0 ? `${changeOrders.pending.length} venter` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <Card className="gap-0 py-0">
      {header}
      <CardContent className="space-y-3 px-4 pb-3">
        <div className="grid grid-cols-2 overflow-hidden rounded-md border sm:grid-cols-4">
          <FlowCell label="Tilbud" value={formatAmount(revenue.offersNok + revenue.hourlyNok)} hint={
            revenue.hourlyNok > 0 ? "Inkl. fakturerbare timer" : `${profitability.acceptedOfferCount} godkjent`
          } />
          <FlowCell
            label="Tillegg"
            value={`+ ${formatAmount(revenue.changeOrdersNok)}`}
            hint={tillegg || (pendingNok > 0 ? `${formatAmount(pendingNok)} venter` : "Ingen ennå")}
          />
          <FlowCell
            label="Kostnad hittil"
            value={formatAmount(actual.totalCostNok)}
            hint={plannedCost ? `av kalkyle ${formatAmount(plannedCost)}` : `av omsetning ${formatAmount(profitability.revenueNok)}`}
          />
          <FlowCell
            label="Dekningsbidrag"
            value={formatAmount(actual.marginNok)}
            hint={`${formatMarginPct(actual.marginPct)} dekningsgrad`}
            tone={marginPositive ? "positive" : "negative"}
          />
        </div>
        <div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <span
              className={cn("block h-full", marginPositive ? "bg-foreground/70" : "bg-destructive")}
              style={{ width: `${costShare}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {costShare} % av {plannedCost ? "kalkylen" : "omsetningen"} er brukt på lønn, materialer og kjøring
          </p>
        </div>
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

function FlowCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: string
  hint: string
  tone?: "positive" | "negative"
}) {
  return (
    <div
      className={cn(
        "min-w-0 border-b border-r px-3 py-2.5 even:border-r-0 sm:border-b-0 sm:even:border-r sm:last:border-r-0 [&:nth-child(n+3)]:border-b-0",
        tone === "positive" && "bg-[color:var(--overlay-success)]",
        tone === "negative" && "bg-[color:var(--overlay-danger)]"
      )}
    >
      <p className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate text-lg font-semibold leading-tight tabular-nums",
          tone === "positive" && "text-[color:var(--tone-success-strong)]",
          tone === "negative" && "text-destructive"
        )}
      >
        {value}
      </p>
      <p className="truncate text-[11px] text-muted-foreground">{hint}</p>
    </div>
  )
}
