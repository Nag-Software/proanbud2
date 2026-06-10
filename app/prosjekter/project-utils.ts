export type StatusConfig = {
  label: string
  filledBars: number
  fillClass: string
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

export const statusConfigByValue: Record<string, StatusConfig> = {
  planning: {
    label: "Planlegges",
    filledBars: 1,
    fillClass: "theme-progress-fill-planning",
  },
  active: {
    label: "Aktiv",
    filledBars: 3,
    fillClass: "theme-progress-fill-active",
  },
  on_hold: {
    label: "Avventer",
    filledBars: 2,
    fillClass: "theme-progress-fill-onhold",
  },
  completed: {
    label: "Fullført",
    filledBars: 3,
    fillClass: "theme-progress-fill-completed",
  },
  rejected: {
    label: "Avvist",
    filledBars: 0,
    fillClass: "theme-progress-fill-danger",
  },
  archived: {
    label: "Arkivert",
    filledBars: 0,
    fillClass: "theme-progress-fill-onhold",
  },
  cancelled: {
    label: "Avbrutt",
    filledBars: 0,
    fillClass: "theme-progress-fill-danger",
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

export function getProjectPeriod(project: ProjectRow) {
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
