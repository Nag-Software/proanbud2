import { type OfferLineItem } from "@/lib/tilbud/types"
import { type CompanyPriceRow } from "@/lib/tilbud/company-price-utils"

const BROAD_CATEGORY_HINTS = [
  "Tak",
  "Yttervegger",
  "Innervegger",
  "Gulv",
  "Bad",
  "Kjøkken",
  "Rør",
  "Elektro",
  "Grunnmur",
  "Isolering",
  "Vinduer",
  "Dører",
  "Annet",
  "Generelt",
] as const

function normalizeText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
}

function normalizeUnit(value: string | null | undefined) {
  const unit = (value || "stk").trim().toLowerCase()
  if (unit === "m²" || unit === "kvm") return "m2"
  if (unit === "meter") return "m"
  if (unit === "timer") return "time"
  return unit
}

export function normalizeQuoteSubproject(raw: string) {
  const trimmed = raw.trim()
  if (!trimmed) return "Generelt"

  const splitMatch = trimmed.split(/\s*[-–—/|:]\s+/)
  if (splitMatch.length >= 2) {
    const head = splitMatch[0]?.trim()
    if (head) {
      const matchedHint = BROAD_CATEGORY_HINTS.find((hint) => normalizeText(head) === normalizeText(hint))
      return matchedHint || head
    }
  }

  const directHint = BROAD_CATEGORY_HINTS.find((hint) => normalizeText(trimmed) === normalizeText(hint))
  if (directHint) return directHint

  for (const hint of BROAD_CATEGORY_HINTS) {
    if (normalizeText(trimmed).startsWith(normalizeText(hint))) {
      return hint
    }
  }

  return trimmed
}

function findPriceRowForLineItem(item: OfferLineItem, companyRows: CompanyPriceRow[]) {
  if (companyRows.length === 0) return null

  if (item.supplierSku?.trim()) {
    const skuMatch = companyRows.find((row) => row.supplier_sku?.trim() === item.supplierSku?.trim())
    if (skuMatch) return skuMatch
  }

  if (item.nobb?.trim()) {
    const nobbMatch = companyRows.find((row) => row.nobb?.trim() === item.nobb?.trim())
    if (nobbMatch) return nobbMatch
  }

  const titleKey = normalizeText(item.title)
  if (!titleKey) return null

  return (
    companyRows.find((row) => {
      const productKey = normalizeText(row.product || "")
      return productKey === titleKey || productKey.includes(titleKey) || titleKey.includes(productKey)
    }) || null
  )
}

export function normalizeQuoteLineItems(input: {
  lineItems: OfferLineItem[]
  companyRows?: CompanyPriceRow[]
}) {
  const warnings: string[] = []
  const companyRows = input.companyRows || []

  const lineItems = input.lineItems.map((item) => {
    const normalizedSubproject = normalizeQuoteSubproject(item.subproject)
    if (normalizedSubproject !== item.subproject.trim()) {
      warnings.push(`Kategorien "${item.subproject}" ble forenklet til "${normalizedSubproject}".`)
    }

    const priceRow = findPriceRowForLineItem(item, companyRows)
    const normalizedUnit = priceRow?.unit ? normalizeUnit(priceRow.unit) : normalizeUnit(item.unit)

    if (priceRow?.unit && normalizeUnit(priceRow.unit) !== normalizeUnit(item.unit)) {
      warnings.push(`Enhet for "${item.title}" ble justert fra "${item.unit}" til "${normalizedUnit}" i tråd med prisfilen.`)
    }

    return {
      ...item,
      subproject: normalizedSubproject,
      unit: normalizedUnit,
      unitPriceNok: priceRow ? Number(priceRow.net_price ?? priceRow.list_price ?? item.unitPriceNok) : item.unitPriceNok,
      supplier: priceRow?.supplier_name?.trim() || item.supplier,
      nobb: priceRow?.nobb?.trim() || item.nobb,
      supplierSku: priceRow?.supplier_sku?.trim() || item.supplierSku,
    }
  })

  return {
    lineItems,
    warnings: Array.from(new Set(warnings)),
  }
}

export function mergeSubprojectCategories(lineItems: OfferLineItem[]) {
  const groups = new Map<string, OfferLineItem[]>()

  for (const item of lineItems) {
    const key = normalizeQuoteSubproject(item.subproject)
    const bucket = groups.get(key) || []
    bucket.push({ ...item, subproject: key })
    groups.set(key, bucket)
  }

  return Array.from(groups.entries()).flatMap(([, items]) => items)
}
