import { describe, expect, it } from "vitest"

import { buildDashboardProjectHealth } from "../../lib/job-costing/project-health"

describe("dashboard project health", () => {
  it("sammenligner førte timer med kalkulerte timer i akseptert tilbud", () => {
    const result = buildDashboardProjectHealth({
      projects: [
        {
          id: "project-1",
          name: "Fasade",
        },
      ],
      offers: [
        {
          project_id: "project-1",
          line_items: [
            {
              id: "line-1",
              subproject: "Fasade",
              title: "Arbeid",
              description: "",
              quantity: 100,
              unit: "time",
              supplier: "",
              unitPriceNok: 500,
              markupPercent: 20,
              discountPercent: 0,
            },
          ],
        },
      ],
      timeEntries: [{ project_id: "project-1", hours: 125 }],
    })

    expect(result.missing).toEqual([])
    expect(result.rows[0]).toMatchObject({
      plannedHours: 100,
      loggedHours: 125,
      hoursUsedPercent: 125,
      overrunHours: 25,
      tone: "danger",
    })
  })

  it("summerer timer fra flere aksepterte tilbud", () => {
    const result = buildDashboardProjectHealth({
      projects: [
        {
          id: "project-1",
          name: "Tak",
        },
      ],
      offers: [
        {
          project_id: "project-1",
          line_items: [
            {
              id: "line-1",
              subproject: "Tak",
              title: "Arbeid",
              description: "",
              quantity: 100,
              unit: "time",
              supplier: "",
              unitPriceNok: 500,
              markupPercent: 20,
              discountPercent: 0,
            },
          ],
        },
        {
          project_id: "project-1",
          line_items: [
            {
              id: "line-2",
              subproject: "Tillegg",
              title: "Ekstraarbeid",
              description: "",
              quantity: 20,
              unit: "timer",
              supplier: "",
              unitPriceNok: 500,
              markupPercent: 20,
              discountPercent: 0,
            },
          ],
        },
      ],
      timeEntries: [{ project_id: "project-1", hours: 30 }],
    })

    expect(result.rows[0]).toMatchObject({
      plannedHours: 120,
      loggedHours: 30,
      hoursUsedPercent: 25,
      overrunHours: 0,
      tone: "normal",
    })
  })

  it("skjuler prosjekter uten kalkulerte timer i tilbudet", () => {
    const result = buildDashboardProjectHealth({
      projects: [
        {
          id: "project-1",
          name: "Bad",
        },
      ],
      offers: [],
      timeEntries: [{ project_id: "project-1", hours: 5 }],
    })

    expect(result.rows).toEqual([])
    expect(result.missing[0]).toEqual({
      id: "project-1",
      name: "Bad",
      reasons: ["offer_hours"],
    })
  })
})
