import { describe, expect, it } from "vitest"

import {
  applySavedJobsToOfferLineItems,
  pickBestSavedJob,
  scoreSavedJobMatch,
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
