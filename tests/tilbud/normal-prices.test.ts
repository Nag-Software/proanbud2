import { describe, expect, it } from "vitest"

import {
  formatNormalPriceForPrompt,
  mapNormalPriceRows,
  pickBestNormalPrice,
  scoreNormalPriceMatch,
} from "../../lib/tilbud/normal-prices"

const rows = mapNormalPriceRows([
  {
    id: "1",
    project_type: "Bad",
    slug: "bad",
    price_low_nok: 35000,
    price_normal_nok: 55000,
    price_high_nok: 80000,
    typical_total_min_nok: 160000,
    typical_total_max_nok: 960000,
    unit: "m2",
  },
  {
    id: "2",
    project_type: "Nybygg enebolig",
    slug: "nybygg-enebolig",
    price_low_nok: 25000,
    price_normal_nok: 35000,
    price_high_nok: 55000,
    typical_total_min_nok: 3600000,
    typical_total_max_nok: 11000000,
    unit: "m2",
  },
])

describe("normal prices", () => {
  it("scores bathroom projects highest for bad-related text", () => {
    const query = "Totalrenovering av bad med nytt sluk og fliser"
    const badScore = scoreNormalPriceMatch(query, rows[0]!)
    const houseScore = scoreNormalPriceMatch(query, rows[1]!)
    expect(badScore).toBeGreaterThan(houseScore)
    expect(pickBestNormalPrice(rows, query)?.slug).toBe("bad")
  })

  it("formats prompt guidance with normal m2 price", () => {
    const formatted = formatNormalPriceForPrompt(rows[0]!)
    expect(formatted.prosjekttype).toBe("Bad")
    expect(formatted.normalPerEnhet).toBe(55000)
    expect(formatted.veiledning).toContain("normalPerEnhet")
  })
})
