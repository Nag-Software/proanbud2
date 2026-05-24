import { type OfferLineItem } from "@/lib/tilbud/types"

export type CompanyPriceRow = {
  product: string | null
  unit: string | null
  net_price: number | null
  list_price: number | null
  category: string | null
  nobb?: string | null
  supplier_sku?: string | null
  supplier_name?: string | null
  product_group_code?: string | null
}

export type CompanyPriceFileMeta = {
  id: string
  supplier_name: string | null
  original_filename?: string | null
  row_count?: number | null
}

export type CompanyPricePromptAttachment = {
  fileId: string
  supplierName: string
  fileName: string
  rowCount: number
  content: string
}

const DEFAULT_HOURLY_RATE_NOK = 795
const DEFAULT_TRANSPORT_RATE_NOK = 950
const DEFAULT_MATERIAL_MARKUP_PERCENT = 15
const DEFAULT_SERVICE_MARKUP_PERCENT = 0
const SERVICE_SUPPLIER = "Eget arbeid"
const PROMPT_PRICE_ROW_LIMIT = 24

const ACCESSORY_TERMS = [
  "adapter",
  "beslag",
  "brikke",
  "fugemasse",
  "fuge",
  "justeringsplate",
  "klips",
  "krok",
  "lim",
  "list",
  "pakning",
  "plate nr",
  "profil",
  "skrue",
  "skive",
  "spiker",
  "teip",
  "tettemasse",
  "vinkel",
]

const QUERY_ACCESSORY_TERMS = ["fugemasse", "lim", "skrue", "spiker", "teip", "beslag", "list", "vinkel"]

const INTENT_RULES: Array<{
  id: string
  queryTerms: string[]
  boostTerms: string[]
  penaltyTerms: string[]
}> = [
  {
    id: "insulation",
    queryTerms: ["etterisolering", "isolasjon", "isolering", "mineralull", "glava", "rockwool", "ull"],
    boostTerms: ["glava", "rockwool", "mineralull", "glassull", "isolasjon", "isolasjons", "ull", "lamell", "batts"],
    penaltyTerms: ["til-tak", "justeringsplate", "forskaling", "takrenne", "takpapp", "beslag"],
  },
  {
    id: "roofing",
    queryTerms: ["tak", "loft", "undertak", "takstein", "himling", "lekt"],
    boostTerms: ["tak", "undertak", "takstein", "loft", "himling", "lekt"],
    penaltyTerms: ["fugemasse", "spiker", "skrue"],
  },
  {
    id: "bathroom",
    queryTerms: ["bad", "baderom", "våtrom", "vatrom", "membran", "flis"],
    boostTerms: ["våtrom", "membran", "flis", "sluk", "baderom"],
    penaltyTerms: ["forskaling", "takplate"],
  },
  {
    id: "flooring",
    queryTerms: ["gulv", "parkett", "laminat"],
    boostTerms: ["gulv", "parkett", "laminat", "underlag"],
    penaltyTerms: ["tak", "undertak"],
  },
  {
    id: "walls",
    queryTerms: ["vegg", "kledning", "vindsperre", "gips"],
    boostTerms: ["vegg", "kledning", "vindsperre", "gips"],
    penaltyTerms: ["takplate", "takstein"],
  },
]

const STOP_TOKENS = new Set([
  "alle",
  "annet",
  "arbeid",
  "bedriftens",
  "beskrivelse",
  "ble",
  "bruk",
  "denne",
  "dette",
  "eller",
  "for",
  "fra",
  "generelt",
  "hentet",
  "hva",
  "hvor",
  "hvis",
  "inkludert",
  "jobb",
  "jobbeskrivelse",
  "kan",
  "komplett",
  "kalkyle",
  "materiallinjer",
  "med",
  "mer",
  "må",
  "ny",
  "oppdrag",
  "oppdraget",
  "prisfil",
  "prisfilen",
  "produkt",
  "skal",
  "som",
  "til",
  "tilbud",
  "tilbudet",
  "uten",
])

const QUERY_TERM_EXPANSIONS: Array<{ pattern: RegExp; terms: string[] }> = [
  {
    pattern: /(etterisol|isolasjon|isolere|mineralull|glava|rockwool|ull)/,
    terms: ["isolasjon", "mineralull", "glava", "rockwool", "ull", "plate", "batts"],
  },
  {
    pattern: /(tak|loft|undertak|takstein|lekt|himling)/,
    terms: ["tak", "loft", "himling", "undertak", "lekt"],
  },
  {
    pattern: /(riving|rive|fjerning|demonter|avfall)/,
    terms: ["riving", "fjerning", "avfall"],
  },
  {
    pattern: /(bad|baderom|våtrom|vatrom|membran|flis)/,
    terms: ["bad", "våtrom", "membran", "flis"],
  },
  {
    pattern: /(gulv|parkett|laminat)/,
    terms: ["gulv", "parkett", "laminat"],
  },
  {
    pattern: /(vegg|kledning|vindsperre|gips)/,
    terms: ["vegg", "kledning", "vindsperre", "gips"],
  },
]

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9æøå\s-]/gi, " ").replace(/\s+/g, " ").trim()
}

function normalizeProductKey(value: string) {
  return normalizeText(value).replace(/\b\d+(?:[.,]\d+)?\b/g, "").replace(/\s+/g, " ").trim()
}

function formatCompanyPriceValue(value: string | number | null | undefined) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : ""
  }

  return value?.trim() || ""
}

function formatCompanyPriceAttachmentContent(rows: CompanyPriceRow[]) {
  const header = "product\tunit\tnet_price\tlist_price\tcategory\tnobb\tsupplier_sku\tproduct_group_code"
  const body = rows.map((row) =>
    [
      formatCompanyPriceValue(row.product),
      formatCompanyPriceValue(row.unit),
      formatCompanyPriceValue(row.net_price),
      formatCompanyPriceValue(row.list_price),
      formatCompanyPriceValue(row.category),
      formatCompanyPriceValue(row.nobb),
      formatCompanyPriceValue(row.supplier_sku),
      formatCompanyPriceValue(row.product_group_code),
    ].join("\t")
  )

  return [header, ...body].join("\n")
}

function countMatchingTerms(haystack: string, terms: string[]) {
  return terms.reduce((count, term) => (haystack.includes(term) ? count + 1 : count), 0)
}

type CompanyPriceRowMatchDiagnostics = {
  score: number
  tokenMatches: number
  longTokenMatches: number
  boostMatches: number
  penaltyMatches: number
  isAccessory: boolean
}

function countIntentQueryMatches(tokens: string[], rule: (typeof INTENT_RULES)[number]) {
  return rule.queryTerms.reduce((count, term) => (tokens.includes(term) ? count + 1 : count), 0)
}

function getDominantIntentRules(tokens: string[]) {
  const rankedRules = INTENT_RULES.map((rule) => ({
    rule,
    queryMatches: countIntentQueryMatches(tokens, rule),
  }))
    .filter((item) => item.queryMatches > 0)
    .sort((left, right) => right.queryMatches - left.queryMatches)

  if (rankedRules.length === 0) {
    return []
  }

  const topQueryMatchCount = rankedRules[0].queryMatches
  if (topQueryMatchCount < 2) {
    return []
  }

  return rankedRules.filter((item) => item.queryMatches === topQueryMatchCount).map((item) => item.rule)
}

function roundQuantity(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function resolveUnitPrice(row: CompanyPriceRow) {
  if (typeof row.net_price === "number" && Number.isFinite(row.net_price) && row.net_price > 0) {
    return row.net_price
  }

  if (typeof row.list_price === "number" && Number.isFinite(row.list_price) && row.list_price > 0) {
    return row.list_price
  }

  return 0
}

function parseAreaEstimate(query: string) {
  const match = query.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|m²)/i)
  if (!match) return null

  const parsed = Number.parseFloat(match[1].replace(",", "."))
  return Number.isFinite(parsed) ? parsed : null
}

function inferWorkTypeFactor(query: string) {
  const normalized = normalizeText(query)

  if (/(etterisol|isolasjon|mineralull|glava|rockwool)/.test(normalized)) return 0.45
  if (/(tak|roof|undertak|lekt|takstein)/.test(normalized)) return 0.7
  if (/(bad|baderom|vatrom|våtrom|membran|flis)/.test(normalized)) return 0.9
  if (/(gulv|parkett)/.test(normalized)) return 0.45

  return 0.35
}

function estimateLaborHours(query: string, materialItems: OfferLineItem[]) {
  const normalized = normalizeText(query)
  const areaEstimate = parseAreaEstimate(query)
  const factor = inferWorkTypeFactor(query)

  let hours = areaEstimate ? areaEstimate * factor : 8

  if (/(riving|rive|fjerning|demonter|avfall)/.test(normalized)) {
    hours += areaEstimate ? Math.max(2, areaEstimate * 0.12) : 4
  }

  if (materialItems.length >= 4) {
    hours += 2
  }

  return Math.max(4, Math.round(hours))
}

function shouldAddTransport(query: string, materialItems: OfferLineItem[]) {
  const normalized = normalizeText(query)
  return materialItems.length > 0 || /(transport|kjoring|kjøring|varebil|levering|henting|avfall)/.test(normalized)
}

function isTransportText(value: string) {
  return /(transport|kjoring|kjøring|varebil|levering|henting|servicebil|avfall)/.test(normalizeText(value))
}

function isLaborText(value: string) {
  return /(arbeid|arbeidstid|montering|utførelse|installasjon|timearbeid|timepris)/.test(normalizeText(value))
}

function shouldExcludeRoofingProductForInsulationQuery(productText: string, query: string) {
  const normalizedQuery = normalizeText(query)
  const normalizedProduct = normalizeText(productText)

  const insulationRequested = /(etterisol|isolasjon|isolering|mineralull|glava|rockwool|glassull|ull)/.test(normalizedQuery)
  const roofingExplicitlyRequested = /(undertak|takpapp|taktekking|omtekking|takstein|lekting)/.test(normalizedQuery)

  if (!insulationRequested || roofingExplicitlyRequested) {
    return false
  }

  return /(undertak|takpapp|underlagstak|tyvek)/.test(normalizedProduct)
}

function isServiceLineItem(item: OfferLineItem) {
  const combined = `${item.title} ${item.description} ${item.unit}`
  return item.unit.toLowerCase().includes("time") || isTransportText(combined) || isLaborText(combined)
}

function buildServiceSupplier(companyName?: string | null) {
  return companyName?.trim() || SERVICE_SUPPLIER
}

function normalizeServiceLineItem(item: OfferLineItem, query: string, companyName?: string | null): OfferLineItem {
  const isTransport = isTransportText(`${item.title} ${item.description}`)
  const quantity = item.quantity > 0 ? item.quantity : isTransport ? 1 : estimateLaborHours(query, [])

  return {
    ...item,
    quantity,
    unit: "time",
    supplier: item.supplier.trim() || buildServiceSupplier(companyName),
    unitPriceNok:
      item.unitPriceNok > 0
        ? item.unitPriceNok
        : isTransport
          ? DEFAULT_TRANSPORT_RATE_NOK
          : DEFAULT_HOURLY_RATE_NOK,
    markupPercent: DEFAULT_SERVICE_MARKUP_PERCENT,
  }
}

export function extractSearchTokens(input: string) {
  const normalized = normalizeText(input)
  const tokens = new Set(
    normalized
      .split(/\s+/)
      .filter((token) => token.length >= 3)
      .filter((token) => !STOP_TOKENS.has(token))
      .filter((token) => !/^\d+$/.test(token))
  )

  for (const expansion of QUERY_TERM_EXPANSIONS) {
    if (!expansion.pattern.test(normalized)) continue
    for (const term of expansion.terms) {
      tokens.add(term)
    }
  }

  return Array.from(tokens)
}

export function scoreCompanyPriceRow(row: CompanyPriceRow, tokens: string[]) {
  const haystack = normalizeText(`${row.product || ""} ${row.category || ""} ${row.supplier_name || ""} ${row.product_group_code || ""}`)
  const productText = normalizeText(row.product || "")
  const tokenSet = new Set(tokens)

  let score = tokens.reduce((total, token) => {
    if (!haystack.includes(token)) return total
    return total + (token.length >= 8 ? 3 : 1)
  }, 0)

  for (const rule of INTENT_RULES) {
    const queryMatchesIntent = rule.queryTerms.some((term) => tokenSet.has(term))
    if (!queryMatchesIntent) continue

    const ruleBoostMatches = countMatchingTerms(productText, rule.boostTerms)
    const rulePenaltyMatches = countMatchingTerms(productText, rule.penaltyTerms)

    score += ruleBoostMatches * 5
    if (rulePenaltyMatches > 0 && ruleBoostMatches === 0) {
      score -= rulePenaltyMatches * 4
    }
  }

  const isAccessory = ACCESSORY_TERMS.some((term) => productText.includes(term))
  const accessoryRequested = QUERY_ACCESSORY_TERMS.some((term) => tokenSet.has(term))
  if (isAccessory && !accessoryRequested) {
    score -= 6
  }

  return score
}

function getCompanyPriceRowMatchDiagnostics(row: CompanyPriceRow, tokens: string[]): CompanyPriceRowMatchDiagnostics {
  const haystack = normalizeText(`${row.product || ""} ${row.category || ""} ${row.supplier_name || ""} ${row.product_group_code || ""}`)
  const productText = normalizeText(`${row.product || ""} ${row.category || ""} ${row.product_group_code || ""}`)
  const tokenSet = new Set(tokens)

  let tokenMatches = 0
  let longTokenMatches = 0
  let boostMatches = 0
  let penaltyMatches = 0

  for (const token of tokens) {
    if (!haystack.includes(token)) continue
    tokenMatches += 1
    if (token.length >= 8) {
      longTokenMatches += 1
    }
  }

  for (const rule of INTENT_RULES) {
    const queryMatchesIntent = rule.queryTerms.some((term) => tokenSet.has(term))
    if (!queryMatchesIntent) continue

    boostMatches += countMatchingTerms(productText, rule.boostTerms)
    penaltyMatches += countMatchingTerms(productText, rule.penaltyTerms)
  }

  const isAccessory = ACCESSORY_TERMS.some((term) => productText.includes(term))

  return {
    score: scoreCompanyPriceRow(row, tokens),
    tokenMatches,
    longTokenMatches,
    boostMatches,
    penaltyMatches,
    isAccessory,
  }
}

function isStrongCompanyPriceRowMatch(row: CompanyPriceRow, tokens: string[]) {
  const diagnostics = getCompanyPriceRowMatchDiagnostics(row, tokens)
  const detailedTokenCount = tokens.filter((token) => token.length >= 5).length
  const productText = normalizeText(`${row.product || ""} ${row.category || ""} ${row.product_group_code || ""}`)
  const dominantIntentRules = getDominantIntentRules(tokens)

  if (diagnostics.score <= 0) {
    return false
  }

  if (dominantIntentRules.length > 0) {
    const dominantBoostMatches = dominantIntentRules.reduce(
      (count, rule) => count + countMatchingTerms(productText, rule.boostTerms),
      0
    )
    const dominantPenaltyMatches = dominantIntentRules.reduce(
      (count, rule) => count + countMatchingTerms(productText, rule.penaltyTerms),
      0
    )

    if (dominantBoostMatches === 0) {
      return false
    }

    if (dominantPenaltyMatches > 0 && dominantBoostMatches === 0) {
      return false
    }
  }

  if (diagnostics.boostMatches >= 1 && diagnostics.penaltyMatches === 0) {
    return true
  }

  if (diagnostics.longTokenMatches >= 1 && diagnostics.tokenMatches >= 2 && diagnostics.score >= 5) {
    return true
  }

  if (detailedTokenCount <= 2 && diagnostics.tokenMatches >= 1 && diagnostics.score >= 4) {
    return true
  }

  if (diagnostics.tokenMatches >= 3 && diagnostics.score >= 6 && diagnostics.penaltyMatches === 0) {
    return true
  }

  return false
}

export function compressCompanyPriceRowsForPrompt(rows: CompanyPriceRow[], limit = PROMPT_PRICE_ROW_LIMIT) {
  const dedupedRows: CompanyPriceRow[] = []
  const seenKeys = new Set<string>()

  for (const row of rows) {
    const key = normalizeProductKey(`${row.product || ""} ${row.supplier_name || ""}`)
    if (!key || seenKeys.has(key)) continue
    seenKeys.add(key)
    dedupedRows.push(row)

    if (dedupedRows.length >= limit) {
      break
    }
  }

  return dedupedRows
}

export function buildAiPriceSelectionContext(input: {
  files: CompanyPriceFileMeta[]
  rows: Array<CompanyPriceRow & { file_id?: string | null }>
}) {
  const supplierNameByFileId = new Map(input.files.map((file) => [file.id, file.supplier_name || null]))

  const allCompanyPrices = input.rows.map((row) => ({
    ...row,
    supplier_name: row.file_id ? supplierNameByFileId.get(row.file_id) || undefined : undefined,
  }))

  const rowsByFileId = new Map<string, CompanyPriceRow[]>()
  for (const row of allCompanyPrices) {
    const fileId = (row as CompanyPriceRow & { file_id?: string | null }).file_id
    if (!fileId) continue

    const current = rowsByFileId.get(fileId) || []
    current.push(row)
    rowsByFileId.set(fileId, current)
  }

  const attachments = input.files
    .map((file) => {
      const rows = rowsByFileId.get(file.id) || []
      if (rows.length === 0) {
        return null
      }

      return {
        fileId: file.id,
        supplierName: file.supplier_name?.trim() || "Ukjent leverandør",
        fileName: file.original_filename?.trim() || `${file.supplier_name || "prisfil"}.csv`,
        rowCount: rows.length,
        content: formatCompanyPriceAttachmentContent(rows),
      } satisfies CompanyPricePromptAttachment
    })
    .filter((attachment): attachment is CompanyPricePromptAttachment => Boolean(attachment))

  return {
    allCompanyPrices,
    attachments,
  }
}

export function selectRelevantCompanyPriceRows(rows: CompanyPriceRow[], query: string, limit = 120) {
  const tokens = extractSearchTokens(query)
  const filteredRows = rows.filter(
    (row) => !shouldExcludeRoofingProductForInsulationQuery(`${row.product || ""} ${row.category || ""}`, query)
  )

  if (tokens.length === 0) {
    return filteredRows.slice(0, limit)
  }

  const scoredRows = filteredRows
    .map((row) => ({ row, score: scoreCompanyPriceRow(row, tokens) }))
    .sort((left, right) => right.score - left.score)

  const strongMatches = scoredRows.filter((item) => isStrongCompanyPriceRowMatch(item.row, tokens))
  if (strongMatches.length > 0) {
    return strongMatches.slice(0, limit).map((item) => item.row)
  }

  return []
}

function findBestCompanyPriceRow(rows: CompanyPriceRow[], query: string) {
  const tokens = extractSearchTokens(query)
  const filteredRows = rows.filter(
    (row) => !shouldExcludeRoofingProductForInsulationQuery(`${row.product || ""} ${row.category || ""}`, query)
  )
  let bestMatch: CompanyPriceRow | null = null
  let bestScore = 0

  for (const row of filteredRows) {
    if (!isStrongCompanyPriceRowMatch(row, tokens)) {
      continue
    }

    const score = scoreCompanyPriceRow(row, tokens)
    if (score > bestScore) {
      bestScore = score
      bestMatch = row
    }
  }

  return bestMatch
}

function createCompanyMaterialLineItem(item: OfferLineItem, row: CompanyPriceRow): OfferLineItem {
  return {
    ...item,
    title: row.product?.trim() || item.title,
    unit: row.unit?.trim() || item.unit,
    supplier: row.supplier_name?.trim() || item.supplier,
    nobb: row.nobb?.trim() || item.nobb,
    supplierSku: row.supplier_sku?.trim() || item.supplierSku,
    supplierUrl: undefined,
    unitPriceNok: resolveUnitPrice(row),
    markupPercent: Number.isFinite(item.markupPercent) ? item.markupPercent : DEFAULT_MATERIAL_MARKUP_PERCENT,
  }
}

function buildFallbackMaterialLineItems(input: {
  companyRows: CompanyPriceRow[]
  query: string
  subprojects: string[]
}): OfferLineItem[] {
  const areaEstimate = parseAreaEstimate(input.query)
  const fallbackRows = selectRelevantCompanyPriceRows(input.companyRows, input.query, 6)

  return fallbackRows.slice(0, 4).map((row, index) => {
    const normalizedUnit = row.unit?.trim().toLowerCase() || "stk"
    const subproject = input.subprojects[index % Math.max(input.subprojects.length, 1)] || "Generelt"
    let quantity = 1

    if (areaEstimate && normalizedUnit === "m2") {
      quantity = roundQuantity(areaEstimate)
    }

    return {
      id: crypto.randomUUID(),
      subproject,
      title: row.product?.trim() || "Produkt fra prisfil",
      description: `Hentet fra bedriftens prisfil${row.category ? ` (${row.category})` : ""}.`,
      quantity,
      unit: row.unit?.trim() || "stk",
      supplier: row.supplier_name?.trim() || "Prisfil",
      nobb: row.nobb?.trim() || undefined,
      supplierSku: row.supplier_sku?.trim() || undefined,
      supplierUrl: undefined,
      unitPriceNok: resolveUnitPrice(row),
      markupPercent: DEFAULT_MATERIAL_MARKUP_PERCENT,
      discountPercent: 0,
    }
  })
}

function createLaborLineItem(query: string, materialItems: OfferLineItem[], subprojects: string[], companyName?: string | null): OfferLineItem {
  return {
    id: crypto.randomUUID(),
    subproject: subprojects[0] || "Generelt",
    title: "Arbeidstid",
    description: "Utførelse og montering beregnet som timearbeid for oppdraget.",
    quantity: estimateLaborHours(query, materialItems),
    unit: "time",
    supplier: buildServiceSupplier(companyName),
    nobb: undefined,
    supplierSku: undefined,
    supplierUrl: undefined,
    unitPriceNok: DEFAULT_HOURLY_RATE_NOK,
    markupPercent: DEFAULT_SERVICE_MARKUP_PERCENT,
    discountPercent: 0,
  }
}

function createTransportLineItem(subprojects: string[], companyName?: string | null): OfferLineItem {
  return {
    id: crypto.randomUUID(),
    subproject: subprojects[0] || "Generelt",
    title: "Transport",
    description: "Transport, kjøring og logistikk til og fra prosjektet.",
    quantity: 1,
    unit: "time",
    supplier: buildServiceSupplier(companyName),
    nobb: undefined,
    supplierSku: undefined,
    supplierUrl: undefined,
    unitPriceNok: DEFAULT_TRANSPORT_RATE_NOK,
    markupPercent: DEFAULT_SERVICE_MARKUP_PERCENT,
    discountPercent: 0,
  }
}

export function finalizeGeneratedOfferLineItems(input: {
  generatedItems: OfferLineItem[]
  companyRows: CompanyPriceRow[]
  query: string
  subprojects: string[]
  companyName?: string | null
  preserveAiMaterialSelections?: boolean
}) {
  const warnings: string[] = []
  const materialItems: OfferLineItem[] = []
  const serviceItems: OfferLineItem[] = []
  const seenCompanyProducts = new Set<string>()

  for (const item of input.generatedItems) {
    if (isServiceLineItem(item)) {
      serviceItems.push(normalizeServiceLineItem(item, input.query, input.companyName))
      continue
    }

    if (shouldExcludeRoofingProductForInsulationQuery(`${item.title} ${item.description}`, input.query)) {
      warnings.push(`Materiallinjen \"${item.title}\" ble fjernet fordi den ser ut som undertak/taktekking i en isolasjonsjobb.`)
      continue
    }

    if (input.companyRows.length === 0) {
      materialItems.push(item)
      continue
    }

    if (input.preserveAiMaterialSelections) {
      const dedupeKey = `${item.supplier || ""}::${item.supplierSku || ""}::${normalizeProductKey(item.title)}`
      if (seenCompanyProducts.has(dedupeKey)) {
        continue
      }

      seenCompanyProducts.add(dedupeKey)
      materialItems.push(item)
      continue
    }

    const match = findBestCompanyPriceRow(
      input.companyRows,
      `${item.title}\n${item.description}\n${item.subproject}\n${input.query}`
    )

    if (!match) {
      warnings.push(`Materiallinjen \"${item.title}\" ble hoppet over fordi den ikke finnes i bedriftens prisfil.`)
      continue
    }

    const matchKey = `${match.supplier_name || ""}::${match.supplier_sku || ""}::${match.product || ""}`
    if (seenCompanyProducts.has(matchKey)) {
      continue
    }

    seenCompanyProducts.add(matchKey)
    materialItems.push(createCompanyMaterialLineItem(item, match))
  }

  if (materialItems.length === 0 && input.companyRows.length > 0) {
    materialItems.push(...buildFallbackMaterialLineItems(input))
    if (materialItems.length > 0) {
      warnings.push("Tilbudet ble bygget direkte fra bedriftens prisfil fordi genererte materiallinjer ikke matchet prisfilen godt nok.")
    }
  }

  const hasLabor = serviceItems.some((item) => item.unit === "time" || isLaborText(`${item.title} ${item.description}`))
  if (!hasLabor) {
    serviceItems.push(createLaborLineItem(input.query, materialItems, input.subprojects, input.companyName))
  }

  const hasTransport = serviceItems.some((item) => item.unit === "time" && isTransportText(`${item.title} ${item.description}`))
  if (!hasTransport && shouldAddTransport(input.query, materialItems)) {
    serviceItems.push(createTransportLineItem(input.subprojects, input.companyName))
  }

  return {
    lineItems: [...materialItems, ...serviceItems],
    warnings: Array.from(new Set(warnings)),
  }
}