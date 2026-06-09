export type TimeEntryRow = {
  id: string
  project_id: string
  user_id: string
  entry_date: string
  hours: number | null
  description: string | null
  started_at: string | null
  ended_at: string | null
  created_at?: string
  users?: { full_name: string | null; email: string | null } | { full_name: string | null; email: string | null }[] | null
  projects?: { name: string } | { name: string }[] | null
}

export function unwrapRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

export function calculateSessionHours(startedAt: string | Date, endedAt: string | Date = new Date()) {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt)
  const end = endedAt instanceof Date ? endedAt : new Date(endedAt)
  const ms = Math.max(0, end.getTime() - start.getTime())
  const hours = Math.round((ms / (1000 * 60 * 60)) * 100) / 100
  return Math.max(0.01, Math.min(24, hours))
}

export function formatDurationFromMs(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}t ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`
}

export function formatDurationFromStartedAt(startedAt: string | Date, now: Date = new Date()) {
  const start = startedAt instanceof Date ? startedAt : new Date(startedAt)
  return formatDurationFromMs(now.getTime() - start.getTime())
}

export function formatHours(hours: number | null | undefined) {
  return `${Number(hours || 0).toFixed(2)} t`
}

export function sumHours(entries: Array<{ hours: number | null | undefined }>) {
  return entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
}

export type ProjectHoursSummary = {
  projectId: string
  projectName: string
  totalHours: number
  entryCount: number
}

export type EmployeeHoursSummary = {
  userId: string
  name: string
  email: string
  totalHours: number
  entryCount: number
  byProject: ProjectHoursSummary[]
}

export function buildEmployeeSummaries(entries: TimeEntryRow[]): EmployeeHoursSummary[] {
  const byUser = new Map<string, EmployeeHoursSummary>()

  for (const entry of entries) {
    if (!entry.hours || !entry.ended_at) continue

    const user = unwrapRelation(entry.users)
    const project = unwrapRelation(entry.projects)
    const userId = entry.user_id
    const existing =
      byUser.get(userId) ||
      ({
        userId,
        name: user?.full_name || user?.email || "Ukjent",
        email: user?.email || "",
        totalHours: 0,
        entryCount: 0,
        byProject: [],
      } satisfies EmployeeHoursSummary)

    existing.totalHours += Number(entry.hours)
    existing.entryCount += 1

    const projectId = entry.project_id
    let projectSummary = existing.byProject.find((item) => item.projectId === projectId)
    if (!projectSummary) {
      projectSummary = {
        projectId,
        projectName: project?.name || "Ukjent prosjekt",
        totalHours: 0,
        entryCount: 0,
      }
      existing.byProject.push(projectSummary)
    }

    projectSummary.totalHours += Number(entry.hours)
    projectSummary.entryCount += 1
    byUser.set(userId, existing)
  }

  return Array.from(byUser.values()).sort((a, b) => b.totalHours - a.totalHours)
}

export function buildProjectSummaries(entries: TimeEntryRow[]): ProjectHoursSummary[] {
  const byProject = new Map<string, ProjectHoursSummary>()

  for (const entry of entries) {
    if (!entry.hours || !entry.ended_at) continue

    const project = unwrapRelation(entry.projects)
    const existing =
      byProject.get(entry.project_id) ||
      ({
        projectId: entry.project_id,
        projectName: project?.name || "Ukjent prosjekt",
        totalHours: 0,
        entryCount: 0,
      } satisfies ProjectHoursSummary)

    existing.totalHours += Number(entry.hours)
    existing.entryCount += 1
    byProject.set(entry.project_id, existing)
  }

  return Array.from(byProject.values()).sort((a, b) => b.totalHours - a.totalHours)
}
