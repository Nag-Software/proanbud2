import { computePlannedCosts } from "@/lib/job-costing/calc"
import type { OfferLineItem } from "@/lib/tilbud/types"

export type ProjectHealthTone = "normal" | "warning" | "danger"

export type DashboardProjectHealth = {
  id: string
  name: string
  hoursUsedPercent: number
  overrunHours: number
  loggedHours: number
  plannedHours: number
  tone: ProjectHealthTone
}

export type MissingProjectHealth = {
  id: string
  name: string
  reasons: Array<"offer_hours">
}

type ProjectRow = {
  id: string
  name: string
}

type OfferRow = {
  project_id: string | null
  line_items: unknown
}

type TimeEntryRow = {
  project_id: string | null
  hours: number | null
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function readLineItems(value: unknown): OfferLineItem[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is OfferLineItem => Boolean(item) && typeof item === "object"
  )
}

function sumByProject<T extends { project_id: string | null }>(
  rows: T[],
  value: (row: T) => number
) {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (!row.project_id) continue
    totals.set(row.project_id, (totals.get(row.project_id) ?? 0) + value(row))
  }
  return totals
}

/**
 * Lager porteføljens tidligvarsel uten prosjektvise databasekall.
 *
 * Sammenligningen bruker bare kalkulerte timer fra aksepterte tilbud og
 * faktisk førte timer i Proanbud. Den krever verken kostnadsfakturaer,
 * lønnssatser eller manuelt vurdert fysisk fremdrift.
 */
export function buildDashboardProjectHealth(input: {
  projects: ProjectRow[]
  offers: OfferRow[]
  timeEntries: TimeEntryRow[]
}): {
  rows: DashboardProjectHealth[]
  missing: MissingProjectHealth[]
} {
  const offersByProject = new Map<string, OfferLineItem[]>()
  for (const offer of input.offers) {
    if (!offer.project_id) continue
    const current = offersByProject.get(offer.project_id) ?? []
    current.push(...readLineItems(offer.line_items))
    offersByProject.set(offer.project_id, current)
  }

  const hoursByProject = sumByProject(input.timeEntries, (row) => Number(row.hours ?? 0))

  const rows: DashboardProjectHealth[] = []
  const missing: MissingProjectHealth[] = []

  for (const project of input.projects) {
    const lineItems = offersByProject.get(project.id) ?? []
    const rawPlanned = lineItems.length > 0 ? computePlannedCosts(lineItems) : null
    const plannedHours = rawPlanned?.hours ?? 0
    const loggedHours = hoursByProject.get(project.id) ?? 0

    const reasons: MissingProjectHealth["reasons"] = []
    if (plannedHours <= 0) reasons.push("offer_hours")

    if (reasons.length > 0) {
      missing.push({ id: project.id, name: project.name, reasons })
      continue
    }

    const hoursUsedPercent = round((loggedHours / plannedHours) * 100)
    const overrunHours = round(Math.max(0, loggedHours - plannedHours))
    const tone: ProjectHealthTone =
      hoursUsedPercent > 100 ? "danger" : hoursUsedPercent >= 90 ? "warning" : "normal"

    rows.push({
      id: project.id,
      name: project.name,
      hoursUsedPercent,
      overrunHours,
      loggedHours: round(loggedHours),
      plannedHours: round(plannedHours),
      tone,
    })
  }

  rows.sort(
    (a, b) => b.hoursUsedPercent - a.hoursUsedPercent || b.loggedHours - a.loggedHours
  )

  return { rows, missing }
}
