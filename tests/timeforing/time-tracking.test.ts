import { describe, expect, it } from "vitest"

import {
  buildEmployeeSummaries,
  buildProjectSummaries,
  calculateSessionHours,
  countDaysInRange,
  filterEntriesByDateRange,
  formatDurationFromMs,
  isEntryInDateRange,
  sumHours,
} from "../../lib/time-tracking"

describe("time-tracking", () => {
  it("calculates session hours from start and end", () => {
    const started = new Date("2026-06-09T08:00:00.000Z")
    const ended = new Date("2026-06-09T10:30:00.000Z")
    expect(calculateSessionHours(started, ended)).toBe(2.5)
  })

  it("formats elapsed duration", () => {
    expect(formatDurationFromMs(90_000)).toBe("1m 30s")
    expect(formatDurationFromMs(3_661_000)).toBe("1t 01m 01s")
  })

  it("builds project summaries from completed entries", () => {
    const summaries = buildProjectSummaries([
      {
        id: "1",
        project_id: "p1",
        user_id: "u1",
        entry_date: "2026-06-09",
        hours: 2,
        description: null,
        started_at: "2026-06-09T08:00:00.000Z",
        ended_at: "2026-06-09T10:00:00.000Z",
        projects: { name: "Bad" },
      },
      {
        id: "2",
        project_id: "p1",
        user_id: "u2",
        entry_date: "2026-06-09",
        hours: 1.5,
        description: null,
        started_at: "2026-06-09T11:00:00.000Z",
        ended_at: "2026-06-09T12:30:00.000Z",
        projects: { name: "Bad" },
      },
    ])

    expect(summaries).toHaveLength(1)
    expect(summaries[0]?.projectName).toBe("Bad")
    expect(summaries[0]?.totalHours).toBe(3.5)
    expect(summaries[0]?.entryCount).toBe(2)
  })

  it("builds employee summaries grouped by project", () => {
    const summaries = buildEmployeeSummaries([
      {
        id: "1",
        project_id: "p1",
        user_id: "u1",
        entry_date: "2026-06-09",
        hours: 4,
        description: null,
        started_at: "2026-06-09T08:00:00.000Z",
        ended_at: "2026-06-09T12:00:00.000Z",
        users: { full_name: "Ola", email: "ola@test.no" },
        projects: { name: "Kjøkken" },
      },
    ])

    expect(summaries[0]?.name).toBe("Ola")
    expect(summaries[0]?.totalHours).toBe(4)
    expect(summaries[0]?.byProject[0]?.projectName).toBe("Kjøkken")
  })

  it("sums hours", () => {
    expect(sumHours([{ hours: 2 }, { hours: 1.25 }])).toBe(3.25)
  })

  it("filters entries by date range including days in between", () => {
    const entries = [
      {
        id: "1",
        project_id: "p1",
        user_id: "u1",
        entry_date: "2026-06-09",
        hours: 2,
        description: null,
        started_at: "2026-06-09T08:00:00.000Z",
        ended_at: "2026-06-09T10:00:00.000Z",
      },
      {
        id: "2",
        project_id: "p1",
        user_id: "u1",
        entry_date: "2026-06-10",
        hours: 3,
        description: null,
        started_at: "2026-06-10T08:00:00.000Z",
        ended_at: "2026-06-10T11:00:00.000Z",
      },
      {
        id: "3",
        project_id: "p1",
        user_id: "u1",
        entry_date: "2026-06-12",
        hours: 1,
        description: null,
        started_at: "2026-06-12T08:00:00.000Z",
        ended_at: "2026-06-12T09:00:00.000Z",
      },
    ]

    const range = {
      from: new Date(2026, 5, 9),
      to: new Date(2026, 5, 10),
    }

    expect(filterEntriesByDateRange(entries, undefined)).toHaveLength(3)
    expect(filterEntriesByDateRange(entries, range).map((entry) => entry.id)).toEqual(["1", "2"])
    expect(countDaysInRange(range)).toBe(2)
    expect(isEntryInDateRange("2026-06-09", range)).toBe(true)
    expect(isEntryInDateRange("2026-06-11", range)).toBe(false)
  })
})
