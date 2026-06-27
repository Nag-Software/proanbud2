import { matchNorwegianSupplierPrices } from "@/lib/tilbud/supplier-prices"
import { logServerError } from "@/lib/errors/log"

export type MaterialWebSearchHit = {
  product: string
  supplier: string
  unit: string
  unitPriceNok: number
  sourceUrl: string
  source: "catalog" | "web"
  query: string
}

const MATERIAL_HINT_PATTERNS = [
  /\b(flis|membran|isolasjon|gips|parkett|takstein|undertak|terrassebord|betong|membran|våtrom|mineralull|lekter|kledning|vindu|dør)\w*/gi,
  /\b\d+\s*x\s*\d+\s*(mm|cm|m)\b/gi,
]

function uniqueTerms(text: string) {
  const found = new Set<string>()
  for (const pattern of MATERIAL_HINT_PATTERNS) {
    const matches = text.match(pattern) ?? []
    for (const match of matches) {
      const normalized = match.trim().toLowerCase()
      if (normalized.length >= 3) found.add(normalized)
    }
  }

  if (found.size === 0) {
    const words = text
      .toLowerCase()
      .split(/[^a-zæøå0-9]+/i)
      .map((word) => word.trim())
      .filter((word) => word.length >= 5)
    for (const word of words.slice(0, 6)) found.add(word)
  }

  return Array.from(found).slice(0, 8)
}

async function searchBraveWeb(query: string): Promise<MaterialWebSearchHit[]> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY?.trim()
  if (!apiKey) return []

  const url = new URL("https://api.search.brave.com/res/v1/web/search")
  url.searchParams.set("q", `${query} pris Norge bygg`)
  url.searchParams.set("count", "5")
  url.searchParams.set("country", "NO")
  url.searchParams.set("search_lang", "no")

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(8000),
  })

  if (!response.ok) return []

  const payload = (await response.json()) as {
    web?: {
      results?: Array<{
        title?: string
        url?: string
        description?: string
      }>
    }
  }

  const results = payload.web?.results ?? []
  const hits: MaterialWebSearchHit[] = []

  for (const result of results) {
    const title = result.title?.trim()
    const sourceUrl = result.url?.trim()
    if (!title || !sourceUrl) continue

    const priceMatch = `${title} ${result.description ?? ""}`.match(/(\d{2,5})\s*(?:kr|,-|nok)/i)
    if (!priceMatch) continue

    const unitPriceNok = Number(priceMatch[1])
    if (!Number.isFinite(unitPriceNok) || unitPriceNok <= 0) continue

    const supplier = inferSupplierFromUrl(sourceUrl)

    hits.push({
      product: title.replace(/\s*[-|].*$/, "").trim(),
      supplier,
      unit: "stk",
      unitPriceNok,
      sourceUrl,
      source: "web",
      query,
    })
  }

  return hits
}

function inferSupplierFromUrl(url: string) {
  const host = url.toLowerCase()
  if (host.includes("byggmakker")) return "Byggmakker"
  if (host.includes("maxbo")) return "MAXBO"
  if (host.includes("monter")) return "Montér"
  if (host.includes("megaflis")) return "Megaflis"
  if (host.includes("obsbygg") || host.includes("obs-bygg")) return "OBS BYGG"
  if (host.includes("nobb")) return "NOBB"
  return "Nettpris"
}

export async function searchMaterialPricesForOffer(input: {
  title: string
  description: string
  sourceSummary?: string
  subprojects?: string[]
}): Promise<MaterialWebSearchHit[]> {
  const combined = `${input.title}\n${input.description}\n${input.sourceSummary ?? ""}`
  const terms = uniqueTerms(combined)
  const hits = new Map<string, MaterialWebSearchHit>()

  const catalogMatches = matchNorwegianSupplierPrices({
    description: combined,
    subprojects: input.subprojects ?? [],
  })

  for (const row of catalogMatches) {
    hits.set(row.id, {
      product: row.product,
      supplier: row.supplier,
      unit: row.unit,
      unitPriceNok: row.unitPriceNok,
      sourceUrl: row.sourceUrl,
      source: "catalog",
      query: "oppdrag",
    })
  }

  // Run the per-term web searches in parallel — sequential awaits (up to 8 terms ×
  // 8s timeout = 64s) could exceed the route maxDuration before the LLM call runs.
  const webResults = await Promise.all(
    terms.map((term) =>
      searchBraveWeb(term).catch((error) => {
        void logServerError({
          message: "Brave material web search failed for term",
          error,
          source: "server",
          route: "searchMaterialPricesForOffer",
          level: "warning",
          context: { term },
        })
        return []
      }),
    ),
  )
  for (const webHits of webResults) {
    for (const hit of webHits) {
      const key = `${hit.product}:${hit.sourceUrl}`
      if (!hits.has(key)) hits.set(key, hit)
    }
  }

  return Array.from(hits.values()).slice(0, 20)
}

export function formatMaterialSearchHitsForPrompt(hits: MaterialWebSearchHit[]) {
  if (hits.length === 0) {
    return {
      tilgjengelig: false,
      instruks:
        "Ingen forhåndssøkte nettpriser. Estimer da fra norsk marked med konkret produktnavn i title og dokumenter kilden i reasoning.",
      treff: [],
    }
  }

  return {
    tilgjengelig: true,
    instruks:
      "Bruk disse prisene når produktet ikke finnes i bedriftens prisfil. Sett konkret produktnavn i title og supplierUrl når tilgjengelig.",
    treff: hits.map((hit) => ({
      produkt: hit.product,
      leverandør: hit.supplier,
      enhet: hit.unit,
      enhetsprisNok: hit.unitPriceNok,
      kilde: hit.source,
      url: hit.sourceUrl,
      søkeord: hit.query,
    })),
  }
}
