import type { CompanyPriceLevel } from "@/lib/tilbud/company-profile"

export type NormalPriceRow = {
  id: string
  project_type: string
  slug: string
  price_low_nok: number
  price_normal_nok: number
  price_high_nok: number
  typical_total_min_nok: number | null
  typical_total_max_nok: number | null
  unit: string
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
}

const PROJECT_TYPE_ALIASES: Record<string, string[]> = {
  "nybygg-enebolig": ["nybygg", "enebolig", "nytt hus", "nytt bygg"],
  tilbygg: ["tilbygg", "pabygg", "utvidelse"],
  bad: ["bad", "våtrom", "vatro"],
  kjokken: ["kjokken", "kitchen"],
  totalrenovering: ["totalrenovering", "total renovering", "rehabilitering"],
  oppussing: ["oppussing", "oppuss", "renovering"],
  garasje: ["garasje", "carport"],
  hytte: ["hytte", "fritidsbolig"],
  flipping: ["flipping", "oppgradering for salg"],
}

export function scoreNormalPriceMatch(query: string, row: NormalPriceRow) {
  const normalizedQuery = normalizeText(query)
  const normalizedType = normalizeText(row.project_type)
  let score = 0

  if (normalizedQuery.includes(normalizedType)) {
    score += 12
  }

  const aliases = PROJECT_TYPE_ALIASES[row.slug] || []
  for (const alias of aliases) {
    if (normalizedQuery.includes(normalizeText(alias))) {
      score += 8
    }
  }

  for (const token of normalizedType.split(/\s+/)) {
    if (token.length >= 4 && normalizedQuery.includes(token)) {
      score += 3
    }
  }

  return score
}

export function pickBestNormalPrice(rows: NormalPriceRow[], query: string) {
  if (rows.length === 0 || !query.trim()) return null

  const scored = rows
    .map((row) => ({ row, score: scoreNormalPriceMatch(query, row) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  return scored[0]?.row || null
}

export function formatNormalPriceForPrompt(row: NormalPriceRow, priceLevel: CompanyPriceLevel = "normal") {
  const totalRange =
    row.typical_total_min_nok && row.typical_total_max_nok
      ? `${Math.round(row.typical_total_min_nok).toLocaleString("no-NO")}-${Math.round(row.typical_total_max_nok).toLocaleString("no-NO")} NOK totalt`
      : null

  const targetField =
    priceLevel === "low" ? "lavPerEnhet" : priceLevel === "high" ? "hoyPerEnhet" : "normalPerEnhet"
  const targetLabel = priceLevel === "low" ? "lav" : priceLevel === "high" ? "høy" : "normal"

  return {
    prosjekttype: row.project_type,
    enhet: row.unit,
    lavPerEnhet: row.price_low_nok,
    normalPerEnhet: row.price_normal_nok,
    hoyPerEnhet: row.price_high_nok,
    typiskTotalpris: totalRange,
    malPerEnhet:
      priceLevel === "low" ? row.price_low_nok : priceLevel === "high" ? row.price_high_nok : row.price_normal_nok,
    veiledning: `Bruk ${targetField} som mål for total m²-pris når du vurderer om kalkylen er realistisk. Bedriftens prisnivå er satt til ${targetLabel}.`,
  }
}

export function mapNormalPriceRows(input: unknown[]): NormalPriceRow[] {
  return input.map((row) => {
    const value = row as Record<string, unknown>
    return {
      id: String(value.id || ""),
      project_type: String(value.project_type || ""),
      slug: String(value.slug || ""),
      price_low_nok: Number(value.price_low_nok || 0),
      price_normal_nok: Number(value.price_normal_nok || 0),
      price_high_nok: Number(value.price_high_nok || 0),
      typical_total_min_nok: value.typical_total_min_nok == null ? null : Number(value.typical_total_min_nok),
      typical_total_max_nok: value.typical_total_max_nok == null ? null : Number(value.typical_total_max_nok),
      unit: String(value.unit || "m2"),
    }
  })
}
