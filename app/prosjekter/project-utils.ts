export type StatusConfig = {
  label: string
  description: string
  filledBars: number
  fillClass: string
  badgeClass: string
  railBorderClass: string
}

export type ProjectCustomer = {
  name?: string | null
  email?: string | null
  phone?: string | null
}

export type ProjectRow = {
  id: string
  name: string
  status: string | null
  customer_id: string | null
  budget_nok: number | null
  start_date: string | null
  end_date: string | null
  customers?: ProjectCustomer | ProjectCustomer[] | null
}

export const ACTIVE_PROJECT_STATUSES = ["planning", "active", "on_hold"] as const
export const ARCHIVE_PROJECT_STATUSES = ["completed", "rejected", "archived", "cancelled"] as const

export const EDITABLE_PROJECT_STATUSES = [
  { value: "planning", label: "Planlegges", description: "Tilbud, planlegging og oppstart" },
  { value: "active", label: "Under utførelse", description: "Arbeid pågår på prosjektet" },
  { value: "on_hold", label: "På pause", description: "Midlertidig stoppet" },
  { value: "completed", label: "Fullført", description: "Levert og avsluttet" },
] as const

export const PROJECT_TYPE_OPTIONS = [
  { value: "nybygg", label: "Nybygg" },
  { value: "rehabilitering", label: "Rehabilitering" },
  { value: "tilbygg", label: "Tilbygg" },
  { value: "vedlikehold", label: "Vedlikehold" },
  { value: "annet", label: "Annet" },
] as const

export type EditableProjectStatus = (typeof EDITABLE_PROJECT_STATUSES)[number]["value"]

export const statusConfigByValue: Record<string, StatusConfig> = {
  planning: {
    label: "Planlegges",
    description: "Tilbud, planlegging og oppstart",
    filledBars: 1,
    fillClass: "theme-progress-fill-planning",
    badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    railBorderClass: "theme-project-rail-planning",
  },
  active: {
    label: "Under utførelse",
    description: "Arbeid pågår på prosjektet",
    filledBars: 3,
    fillClass: "theme-progress-fill-active",
    badgeClass: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    railBorderClass: "theme-project-rail-active",
  },
  on_hold: {
    label: "På pause",
    description: "Midlertidig stoppet",
    filledBars: 2,
    fillClass: "theme-progress-fill-onhold",
    badgeClass: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    railBorderClass: "theme-project-rail-onhold",
  },
  completed: {
    label: "Fullført",
    description: "Levert og avsluttet",
    filledBars: 3,
    fillClass: "theme-progress-fill-completed",
    badgeClass: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
    railBorderClass: "theme-project-rail-completed",
  },
  rejected: {
    label: "Avvist",
    description: "Prosjektet ble ikke gjennomført",
    filledBars: 0,
    fillClass: "theme-progress-fill-danger",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    railBorderClass: "theme-project-rail-danger",
  },
  archived: {
    label: "Arkivert",
    description: "Lagret som tidligere prosjekt",
    filledBars: 0,
    fillClass: "theme-progress-fill-onhold",
    badgeClass: "bg-muted text-muted-foreground",
    railBorderClass: "theme-project-rail-onhold",
  },
  cancelled: {
    label: "Avbrutt",
    description: "Prosjektet ble avbrutt",
    filledBars: 0,
    fillClass: "theme-progress-fill-danger",
    badgeClass: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    railBorderClass: "theme-project-rail-danger",
  },
}

export const totalStatusBars = 3

export function formatProjectDate(value: string | null) {
  if (!value) return "–"
  return new Date(value).toLocaleDateString("no-NO", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  })
}

export function getProjectCustomer(project: ProjectRow) {
  const customer = Array.isArray(project.customers) ? project.customers[0] : project.customers

  return {
    name: customer?.name || "Ukjent kunde",
    email: customer?.email || null,
    phone: customer?.phone || null,
  }
}

export function getProjectCode(id: string) {
  return `PRJ-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`
}

export function getProjectPeriod(project: Pick<ProjectRow, "start_date" | "end_date">) {
  const start = formatProjectDate(project.start_date)
  const end = formatProjectDate(project.end_date)

  if (start === "–" && end === "–") return "Ikke satt"
  return `${start} – ${end}`
}

export function getStatusConfig(status: string | null | undefined) {
  return statusConfigByValue[status || "planning"] || statusConfigByValue.planning
}

export function isActiveProject(status: string | null | undefined) {
  return ACTIVE_PROJECT_STATUSES.includes(status as (typeof ACTIVE_PROJECT_STATUSES)[number])
}

export function isArchiveProject(status: string | null | undefined) {
  return ARCHIVE_PROJECT_STATUSES.includes(status as (typeof ARCHIVE_PROJECT_STATUSES)[number])
}

export function getDaysRemaining(endDate: string | null): number | null {
  if (!endDate) return null
  const end = new Date(endDate)
  end.setHours(23, 59, 59, 999)
  const now = new Date()
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

export function formatDaysRemaining(endDate: string | null): string {
  const days = getDaysRemaining(endDate)
  if (days === null) return "Ingen sluttdato"
  if (days < 0) return `${Math.abs(days)} dager over`
  if (days === 0) return "Siste dag"
  if (days === 1) return "1 dag igjen"
  return `${days} dager igjen`
}

export function getTimelineProgress(startDate: string | null, endDate: string | null): number {
  if (!startDate || !endDate) return 0
  const start = new Date(startDate).getTime()
  const end = new Date(endDate).getTime()
  const now = Date.now()
  if (now <= start) return 0
  if (now >= end) return 100
  return Math.round(((now - start) / (end - start)) * 100)
}

export function isPastDeadline(
  endDate: string | null,
  status: string | null | undefined
): boolean {
  if (!endDate || status === "completed") return false
  return getDaysRemaining(endDate) !== null && (getDaysRemaining(endDate) as number) < 0
}
