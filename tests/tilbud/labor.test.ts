import { describe, expect, it } from "vitest"

import { computePlannedCosts } from "@/lib/job-costing/calc"
import { finalizeGeneratedOfferLineItems } from "@/lib/tilbud/company-price-utils"
import {
  DEFAULT_HOURLY_RATE_NOK,
  DEFAULT_TRANSPORT_RATE_NOK,
  mapHourlyRateRows,
  matchHourlyRate,
  normalizeLaborLineItem,
  resolveHourlyRate,
  type CompanyHourlyRate,
} from "@/lib/tilbud/labor"
import type { OfferLineItem } from "@/lib/tilbud/types"

const RATES: CompanyHourlyRate[] = [
  { jobType: "Tømrerarbeid", hourlyRateNok: 850, costRateNok: 520 },
  { jobType: "Flislegger", hourlyRateNok: 950, costRateNok: 600 },
  { jobType: "Elektriker", hourlyRateNok: 1100, costRateNok: null },
]

function item(overrides: Partial<OfferLineItem>): OfferLineItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    subproject: "Generelt",
    title: "Linje",
    description: "",
    quantity: 1,
    unit: "stk",
    supplier: "",
    unitPriceNok: 0,
    markupPercent: 15,
    discountPercent: 0,
    ...overrides,
  }
}

describe("matchHourlyRate / resolveHourlyRate", () => {
  it("matcher jobbtype på ordstamme", () => {
    expect(matchHourlyRate(RATES, "Flislegging vegg og gulv")?.jobType).toBe("Flislegger")
    expect(matchHourlyRate(RATES, "Tømrer – nytt innervegg")?.jobType).toBe("Tømrerarbeid")
    expect(matchHourlyRate(RATES, "Elektrikerarbeid varmekabler")?.jobType).toBe("Elektriker")
  })

  it("bruker bedriftens første timepris når ingen jobbtype passer", () => {
    expect(resolveHourlyRate(RATES, "Riving av bad")).toEqual({
      rateNok: 850,
      jobType: "Tømrerarbeid",
      source: "company",
    })
  })

  it("bruker standardsats når bedriften ikke har timepriser", () => {
    expect(resolveHourlyRate([], "Flislegging")).toEqual({
      rateNok: DEFAULT_HOURLY_RATE_NOK,
      jobType: null,
      source: "default",
    })
  })

  it("mapHourlyRateRows forkaster tomme og ugyldige rader", () => {
    expect(
      mapHourlyRateRows([
        { job_type: "Maler", hourly_rate_nok: "780.00", cost_rate_nok: null },
        { job_type: "", hourly_rate_nok: 900 },
        { job_type: "Null", hourly_rate_nok: 0 },
      ])
    ).toEqual([{ jobType: "Maler", hourlyRateNok: 780, costRateNok: null }])
  })
})

describe("normalizeLaborLineItem", () => {
  it("setter bedriftens timepris på timelinjer og fjerner påslag", () => {
    const result = normalizeLaborLineItem(
      item({ title: "Flislegging", unit: "timer", quantity: 14, unitPriceNok: 890, markupPercent: 10 }),
      RATES
    )
    expect(result).toMatchObject({ unit: "time", quantity: 14, unitPriceNok: 950, markupPercent: 0 })
    expect(result.reasoning).toContain("Flislegger")
  })

  it("regner arbeid i m2 om til timer med samme sum, ikke 22 m2 → 22 timer", () => {
    const result = normalizeLaborLineItem(
      item({ title: "Flislegging vegg", unit: "m2", quantity: 22, unitPriceNok: 450, markupPercent: 0 }),
      RATES
    )
    // 22 × 450 = 9 900 kr → 9 900 / 950 = 10,4 → 10,5 timer
    expect(result).toMatchObject({ unit: "time", quantity: 10.5, unitPriceNok: 950 })
    expect(result.reasoning).toContain("Omregnet fra 22 m2")
  })
})

describe("finalizeGeneratedOfferLineItems — arbeid og transport", () => {
  const base = {
    companyRows: [],
    query: "Totalrenovering bad 5 m2",
    subprojects: ["Bad"],
    companyName: "Proffbud AS",
  }

  it("priser arbeid med bedriftens timepriser og beholder materialer", () => {
    const { lineItems } = finalizeGeneratedOfferLineItems({
      ...base,
      hourlyRates: RATES,
      generatedItems: [
        item({ title: "Membran 15 kg", unit: "stk", quantity: 1, unitPriceNok: 1054 }),
        item({ subproject: "Arbeid", title: "Flislegging vegg", unit: "m2", quantity: 22, unitPriceNok: 450, markupPercent: 0 }),
        item({ subproject: "Arbeid", title: "Riving", unit: "time", quantity: 8, unitPriceNok: 890, markupPercent: 0 }),
      ],
    })

    const labor = lineItems.filter((line) => line.unit === "time" && line.title !== "Transport")
    expect(labor.map((line) => [line.title, line.quantity, line.unitPriceNok])).toEqual([
      ["Flislegging vegg", 10.5, 950],
      ["Riving", 8, 850],
    ])
    expect(lineItems.find((line) => line.title === "Membran 15 kg")).toMatchObject({ unit: "stk", unitPriceNok: 1054 })
  })

  it("fører transport i timer med transportsats, og lar avfallscontainer være en kostnad", () => {
    const { lineItems } = finalizeGeneratedOfferLineItems({
      ...base,
      hourlyRates: RATES,
      generatedItems: [
        item({ subproject: "Arbeid", title: "Montering", unit: "time", quantity: 10, unitPriceNok: 0 }),
        item({ title: "Transport", unit: "stk", quantity: 2, unitPriceNok: 950, markupPercent: 0 }),
        item({ title: "Avfallscontainer 8 m³", unit: "stk", quantity: 1, unitPriceNok: 3500 }),
      ],
    })

    // 2 × 950 = 1 900 kr → 2 timer à standard transportsats (bedriften har ingen «Transport»-sats)
    expect(lineItems.find((line) => line.title === "Transport")).toMatchObject({
      unit: "time",
      quantity: 2,
      unitPriceNok: DEFAULT_TRANSPORT_RATE_NOK,
    })
    expect(lineItems.find((line) => line.title === "Avfallscontainer 8 m³")).toMatchObject({ unit: "stk", quantity: 1 })
    expect(computePlannedCosts(lineItems).hours).toBe(12)
  })

  it("bruker bedriftens egen transportsats når den finnes", () => {
    const { lineItems } = finalizeGeneratedOfferLineItems({
      ...base,
      hourlyRates: [...RATES, { jobType: "Transport", hourlyRateNok: 700, costRateNok: null }],
      generatedItems: [
        item({ subproject: "Arbeid", title: "Montering", unit: "time", quantity: 10, unitPriceNok: 0 }),
        item({ title: "Kjøring til byggeplass", unit: "time", quantity: 3, unitPriceNok: 0 }),
      ],
    })
    expect(lineItems.find((line) => line.title === "Kjøring til byggeplass")).toMatchObject({
      unit: "time",
      quantity: 3,
      unitPriceNok: 700,
    })
  })

  it("gjør ikke en prisfil-vare med «montering» i navnet om til arbeid", () => {
    const { lineItems } = finalizeGeneratedOfferLineItems({
      ...base,
      hourlyRates: RATES,
      generatedItems: [
        item({ title: "Monteringslim 290 ml", unit: "stk", quantity: 3, unitPriceNok: 129, nobb: "12345678", priceSource: "prisfil" }),
        item({ subproject: "Arbeid", title: "Montering", unit: "time", quantity: 4, unitPriceNok: 0 }),
      ],
    })

    expect(lineItems.find((line) => line.title === "Monteringslim 290 ml")).toMatchObject({ unit: "stk", quantity: 3 })
  })

  it("legger til arbeidstid med standardsats når KI-en glemte arbeid og bedriften mangler timepriser", () => {
    const { lineItems } = finalizeGeneratedOfferLineItems({
      ...base,
      generatedItems: [item({ title: "Membran 15 kg", unit: "stk", quantity: 1, unitPriceNok: 1054 })],
    })

    const labor = lineItems.find((line) => line.unit === "time")
    expect(labor).toMatchObject({ title: "Arbeidstid", unitPriceNok: DEFAULT_HOURLY_RATE_NOK, markupPercent: 0 })
  })
})
