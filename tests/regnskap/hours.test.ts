import { describe, expect, it } from "vitest"

import {
  aggregateApprovedHours,
  hoursKey,
  pickTimesheetActivity,
  planTimesheetChanges,
} from "@/lib/regnskap/hours"

const row = (over: Partial<Parameters<typeof aggregateApprovedHours>[0][number]> = {}) => ({
  user_id: "u1",
  project_id: "p1",
  entry_date: "2026-09-01",
  hours: 3,
  description: null,
  ...over,
})

describe("aggregateApprovedHours", () => {
  it("summerer flere økter samme dag til én timeføring", () => {
    const result = aggregateApprovedHours([
      row({ hours: 3, description: "Riving" }),
      row({ hours: "4.5", description: "Riving" }),
      row({ hours: 1, description: "Rydding" }),
    ])
    const agg = result.get(hoursKey("u1", "p1", "2026-09-01"))!
    expect(agg.hours).toBe(8.5)
    // Like notater slås sammen, ulike beholdes.
    expect(agg.comment).toBe("Riving; Rydding")
  })

  it("holder ansatte, prosjekter og dager hver for seg", () => {
    const result = aggregateApprovedHours([
      row(),
      row({ user_id: "u2" }),
      row({ project_id: "p2" }),
      row({ entry_date: "2026-09-02" }),
    ])
    expect(result.size).toBe(4)
  })

  it("hopper over rader uten gyldige timer", () => {
    expect(aggregateApprovedHours([row({ hours: 0 }), row({ hours: null }), row({ hours: "x" })]).size).toBe(0)
  })
})

describe("planTimesheetChanges", () => {
  const link = (over: Record<string, unknown> = {}) => ({
    user_id: "u1",
    project_id: "p1",
    entry_date: "2026-09-01",
    external_id: 55,
    activity_external_id: 7,
    pushed_hours: "8.50",
    ...over,
  })

  it("gjør ingenting når regnskapet allerede speiler timene", () => {
    const plan = planTimesheetChanges(aggregateApprovedHours([row({ hours: 8.5 })]), [link()])
    expect(plan).toEqual({ create: [], update: [], remove: [] })
  })

  it("oppretter nye, oppdaterer endrede og sletter bortfalte", () => {
    const aggregates = aggregateApprovedHours([
      row({ hours: 6 }),
      row({ entry_date: "2026-09-03", hours: 2 }),
    ])
    const plan = planTimesheetChanges(aggregates, [
      link(),
      link({ entry_date: "2026-09-02", external_id: 56 }),
    ])
    expect(plan.create.map((a) => a.date)).toEqual(["2026-09-03"])
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0].aggregate.hours).toBe(6)
    expect(plan.remove.map((l) => l.external_id)).toEqual([56])
  })
})

describe("pickTimesheetActivity", () => {
  it("foretrekker en arbeidsaktivitet, ellers den første", () => {
    expect(pickTimesheetActivity([{ id: 1, name: "Reise" }, { id: 2, name: "Prosjektarbeid" }])).toBe(2)
    expect(pickTimesheetActivity([{ id: 1, name: "Reise" }, { id: 2, name: "Møte" }])).toBe(1)
    expect(pickTimesheetActivity([])).toBeNull()
  })
})
