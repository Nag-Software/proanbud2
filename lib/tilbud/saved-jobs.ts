import type { OfferLineItem } from "@/lib/tilbud/types"

export type SavedJobRow = {
  id: string
  name: string
  price_nok: number
}

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9æøå\s-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokenMatchesQuery(token: string, query: string) {
  if (query.includes(token)) return true
  if (token.length >= 5 && query.includes(token.slice(0, token.length - 1))) return true
  if (token.length >= 6 && query.includes(token.slice(0, token.length - 2))) return true
  return false
}

export function scoreSavedJobMatch(query: string, job: SavedJobRow) {
  const normalizedQuery = normalizeText(query)
  const normalizedName = normalizeText(job.name)

  if (!normalizedName || !normalizedQuery) return 0

  if (normalizedQuery.includes(normalizedName)) {
    return 20 + Math.min(normalizedName.length, 20)
  }

  const tokens = normalizedName.split(/\s+/).filter((token) => token.length >= 3)
  if (tokens.length === 0) {
    return normalizedQuery.includes(normalizedName) ? 10 : 0
  }

  const matchedTokens = tokens.filter((token) => tokenMatchesQuery(token, normalizedQuery))
  if (matchedTokens.length === tokens.length) {
    return 12 + matchedTokens.length * 4
  }

  if (matchedTokens.length >= 2) {
    return 10 + matchedTokens.length * 2
  }

  if (matchedTokens.length === 1 && tokens.length === 1) {
    return 9
  }

  return 0
}

export function mapSavedJobRows(input: unknown[]): SavedJobRow[] {
  return input.map((row) => {
    const value = row as Record<string, unknown>
    return {
      id: String(value.id || ""),
      name: String(value.name || ""),
      price_nok: Number(value.price_nok || 0),
    }
  })
}

export function pickRelevantSavedJobs(rows: SavedJobRow[], query: string, minScore = 10) {
  return rows
    .map((job) => ({ job, score: scoreSavedJobMatch(query, job) }))
    .filter((item) => item.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.job)
}

export function pickBestSavedJob(rows: SavedJobRow[], query: string) {
  const ranked = rows
    .map((job) => ({ job, score: scoreSavedJobMatch(query, job) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  return ranked[0]?.job ?? null
}

export function formatSavedJobsForPrompt(rows: SavedJobRow[]) {
  return rows.map((job) => ({
    navn: job.name,
    fastprisNok: job.price_nok,
  }))
}

export function formatMatchedSavedJobForPrompt(job: SavedJobRow) {
  return {
    navn: job.name,
    fastprisNok: job.price_nok,
    veiledning:
      "Denne jobben har fastpris i bedriftens lagrede jobber. Bruk fastprisen som totalpris for jobben med quantity 1, unit 'fastpris' og markupPercent 0.",
  }
}

function isLaborOrTransportLine(item: OfferLineItem) {
  const haystack = normalizeText(`${item.title} ${item.description} ${item.unit}`)
  return item.unit.toLowerCase() === "time" || /arbeid|transport|montering|utforelse|installasjon/.test(haystack)
}

export function lineItemMatchesSavedJob(item: OfferLineItem, job: SavedJobRow) {
  const haystack = normalizeText(`${item.title} ${item.description}`)
  const normalizedName = normalizeText(job.name)

  if (!normalizedName) return false
  if (haystack.includes(normalizedName)) return true

  const tokens = normalizedName.split(/\s+/).filter((token) => token.length >= 4)
  if (tokens.length === 0) return false

  return tokens.every((token) => tokenMatchesQuery(token, haystack))
}

export function buildOfferLineItemFromSavedJob(
  job: SavedJobRow,
  subproject: string,
  companyName?: string | null
): OfferLineItem {
  return createSavedJobLineItem(job, subproject, companyName)
}

function createSavedJobLineItem(job: SavedJobRow, subproject: string, companyName?: string | null): OfferLineItem {
  return {
    id: crypto.randomUUID(),
    subproject,
    title: job.name,
    description: "Fastpris fra bedriftens lagrede jobber.",
    quantity: 1,
    unit: "fastpris",
    supplier: companyName?.trim() || "Eget arbeid",
    unitPriceNok: job.price_nok,
    markupPercent: 0,
    discountPercent: 0,
  }
}

function formatSavedJobPrice(value: number) {
  return `${Math.round(value).toLocaleString("no-NO")} kr`
}

export function applySavedJobsToOfferLineItems(input: {
  lineItems: OfferLineItem[]
  savedJobs: SavedJobRow[]
  query: string
  subprojects: string[]
  companyName?: string | null
}) {
  const warnings: string[] = []

  if (input.savedJobs.length === 0 || !input.query.trim()) {
    return { lineItems: input.lineItems, warnings }
  }

  const matches = input.savedJobs
    .map((job) => ({ job, score: scoreSavedJobMatch(input.query, job) }))
    .filter((item) => item.score >= 10)
    .sort((left, right) => right.score - left.score)

  if (matches.length === 0) {
    return { lineItems: input.lineItems, warnings }
  }

  const subproject = input.subprojects.find(Boolean) || "Annet"
  let lineItems = [...input.lineItems]
  const appliedJobIds = new Set<string>()

  for (const { job, score } of matches) {
    const existingIndex = lineItems.findIndex((item) => lineItemMatchesSavedJob(item, job))

    if (existingIndex >= 0) {
      lineItems[existingIndex] = {
        ...lineItems[existingIndex]!,
        title: job.name,
        description: "Fastpris fra bedriftens lagrede jobber.",
        quantity: 1,
        unit: "fastpris",
        supplier: lineItems[existingIndex]!.supplier.trim() || input.companyName?.trim() || "Eget arbeid",
        unitPriceNok: job.price_nok,
        markupPercent: 0,
      }
      appliedJobIds.add(job.id)
      warnings.push(`Oppdaterte «${job.name}» til fastpris ${formatSavedJobPrice(job.price_nok)}.`)
      continue
    }

    if (score >= 12) {
      lineItems.unshift(createSavedJobLineItem(job, subproject, input.companyName))
      appliedJobIds.add(job.id)
      warnings.push(`La til fastpris for «${job.name}» (${formatSavedJobPrice(job.price_nok)}).`)
    }
  }

  if (appliedJobIds.size > 0) {
    const appliedMatches = matches.filter((item) => appliedJobIds.has(item.job.id))
    lineItems = lineItems.filter((item) => {
      if (!isLaborOrTransportLine(item)) return true
      return !appliedMatches.some(({ job }) => lineItemMatchesSavedJob(item, job))
    })
  }

  const topMatch = matches[0]!
  const isFocusedSingleJob =
    topMatch.score >= 22 &&
    (matches.length === 1 || topMatch.score - (matches[1]?.score ?? 0) >= 8) &&
    lineItems.filter((item) => item.unit !== "fastpris").every((item) => isLaborOrTransportLine(item))

  if (isFocusedSingleJob) {
    warnings.push(`Erstattet arbeidslinjer med fastpris for «${topMatch.job.name}».`)
    return {
      lineItems: [createSavedJobLineItem(topMatch.job, subproject, input.companyName)],
      warnings,
    }
  }

  return { lineItems, warnings }
}
