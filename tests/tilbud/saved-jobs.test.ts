import { describe, expect, it } from "vitest"

import {
  applySavedJobsToOfferLineItems,
  buildOfferLineItemFromSavedJob,
  mapSavedJobRows,
  pickBestSavedJob,
  scoreSavedJobMatch,
  withSavedJobHoursFallback,
} from "../../lib/tilbud/saved-jobs"

const jobs = [
  { id: "1", name: "Vindusbytte", price_nok: 5000 },
  { id: "2", name: "Montere kjøkken", price_nok: 3000 },
]

describe("saved jobs", () => {
  it("matches saved job names in offer descriptions", () => {
    const query = "Kunden trenger vindusbytte i stue"
    expect(scoreSavedJobMatch(query, jobs[0]!)).toBeGreaterThan(scoreSavedJobMatch(query, jobs[1]!))
    expect(pickBestSavedJob(jobs, query)?.name).toBe("Vindusbytte")
  })

  it("applies fixed price line items when a saved job is relevant", () => {
    const result = applySavedJobsToOfferLineItems({
      lineItems: [
        {
          id: "line-1",
          subproject: "Annet",
          title: "Arbeidstid",
          description: "Montering av kjøkken",
          quantity: 6,
          unit: "time",
          supplier: "Eget arbeid",
          unitPriceNok: 795,
          markupPercent: 0,
          discountPercent: 0,
        },
      ],
      savedJobs: jobs,
      query: "Montere nytt kjøkken for kunde",
      subprojects: ["Kjøkken"],
      companyName: "Test AS",
    })

    expect(result.lineItems.some((item) => item.unit === "fastpris" && item.unitPriceNok === 3000)).toBe(true)
    expect(result.lineItems.some((item) => item.unit === "time")).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe("saved jobs — timer", () => {
  it("tar med beregnede timer inn i fastprislinjen", () => {
    const line = buildOfferLineItemFromSavedJob(
      { id: "j1", name: "Vindusbytte", price_nok: 6000, estimated_hours: 3.5 },
      "Vinduer",
      "Firma AS"
    )
    expect(line).toMatchObject({ unit: "fastpris", quantity: 1, unitPriceNok: 6000, plannedHours: 3.5 })
  })

  it("lar plannedHours være tom når jobben ikke har timer", () => {
    const line = buildOfferLineItemFromSavedJob({ id: "j2", name: "Kjøkken", price_nok: 20000 }, "Kjøkken")
    expect(line.plannedHours).toBeUndefined()
  })

  it("mapSavedJobRows leser estimated_hours og ignorerer 0/ugyldig", () => {
    expect(
      mapSavedJobRows([
        { id: "a", name: "A", price_nok: "100", estimated_hours: "2.5" },
        { id: "b", name: "B", price_nok: 100, estimated_hours: 0 },
        { id: "c", name: "C", price_nok: 100 },
      ]).map((job) => job.estimated_hours)
    ).toEqual([2.5, null, null])
  })

  it("prøver uten estimated_hours når kolonnen mangler (db/97 ikke kjørt)", async () => {
    const calls: boolean[] = []
    const result = await withSavedJobHoursFallback(async (withHours) => {
      calls.push(withHours)
      return withHours
        ? { data: null, error: { code: "42703", message: "column saved_jobs.estimated_hours does not exist" } }
        : { data: [{ id: "a" }], error: null }
    })
    expect(calls).toEqual([true, false])
    expect(result.data).toEqual([{ id: "a" }])
  })
})
