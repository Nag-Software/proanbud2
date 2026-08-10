import { type OfferLineItem } from "@/lib/tilbud/types"
import { type CompanyPriceRow } from "@/lib/tilbud/company-price-utils"

const BROAD_CATEGORY_HINTS = [
  "Arbeid",
  "Transport",
  "Tak",
  "Yttervegger",
  "Innervegger",
  "Gulv",
  "Bad",
  "Terrasse",
  "Kjøkken",
  "Rør",
  "Elektro",
  "Grunnmur",
  "Grunnarbeid",
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

function rowPrice(row: CompanyPriceRow) {
  return Number(row.net_price ?? row.list_price ?? Number.NaN)
}

/** Egen formatering i varsler: formatNok runder til hele kroner og ville skjult
 *  små, men reelle prisendringer (129,50 → 129,90 blir «130 kr → 130 kr»). */
function priceLabel(value: number) {
  return `${value.toLocaleString("no-NO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kr`
}

type PriceMatch =
  | { kind: "match"; row: CompanyPriceRow }
  | { kind: "ambiguous"; count: number }
  | { kind: "none" }

/**
 * Finner prisfilraden en KI-generert linje faktisk refererer til.
 *
 * Kun IDENTITET teller: leverandørens artikkelnummer, NOBB, eller nøyaktig samme
 * produktnavn. Tidligere holdt det at navnene inneholdt hverandre begge veier, og
 * første treff i array-rekkefølge vant — da traff «Gips» hvilken som helst rad med
 * «gips» i seg, og prisen ble overskrevet med feil produkt. En feil pris er verre
 * enn ingen pris: uten treff beholder vi KI-ens tall og merker linjen som anslag.
 */
function findPriceRowForLineItem(item: OfferLineItem, companyRows: CompanyPriceRow[]): PriceMatch {
  if (companyRows.length === 0) return { kind: "none" }

  const sku = item.supplierSku?.trim()
  if (sku) {
    const skuMatch = companyRows.find((row) => row.supplier_sku?.trim() === sku)
    if (skuMatch) return { kind: "match", row: skuMatch }
  }

  const nobb = item.nobb?.trim()
  if (nobb) {
    const nobbMatch = companyRows.find((row) => row.nobb?.trim() === nobb)
    if (nobbMatch) return { kind: "match", row: nobbMatch }
  }

  const titleKey = normalizeText(item.title)
  if (!titleKey) return { kind: "none" }

  const exact = companyRows.filter((row) => normalizeText(row.product || "") === titleKey)
  if (exact.length === 0) return { kind: "none" }
  if (exact.length === 1) return { kind: "match", row: exact[0] }

  // Samme produktnavn flere steder: greit så lenge prisen er den samme (duplikate
  // filer), men ved ulik pris kan vi ikke gjette hvilken bedriften mente.
  const distinctPrices = new Set(exact.map((row) => rowPrice(row)))
  if (distinctPrices.size === 1) return { kind: "match", row: exact[0] }
  return { kind: "ambiguous", count: exact.length }
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

    const match = findPriceRowForLineItem(item, companyRows)

    if (match.kind === "ambiguous") {
      warnings.push(
        `"${item.title}" finnes ${match.count} ganger i prisfilene med ulik pris. Prisen er ikke endret — velg riktig rad selv.`
      )
    }

    // Lagrede jobber (fastpris) settes av applySavedJobsToOfferLineItems etterpå;
    // her avgjør vi bare om prisen har dekning i en prisfilrad eller ikke.
    if (match.kind !== "match") {
      const unit = normalizeUnit(item.unit)
      // Arbeid og fastpris måles ikke mot prisfilene — de er materialkataloger.
      // Å merke hver eneste timelinje som «anslag» ville gjort merket til støy,
      // og da slutter håndverkeren å se de materialprisene som faktisk er gjettet.
      const isService = unit === "time" || unit === "fastpris"

      return {
        ...item,
        subproject: normalizedSubproject,
        unit,
        priceSource: isService ? item.priceSource : (item.priceSource ?? ("anslag" as const)),
      }
    }

    const priceRow = match.row
    const normalizedUnit = priceRow.unit ? normalizeUnit(priceRow.unit) : normalizeUnit(item.unit)

    if (priceRow.unit && normalizeUnit(priceRow.unit) !== normalizeUnit(item.unit)) {
      warnings.push(`Enhet for "${item.title}" ble justert fra "${item.unit}" til "${normalizedUnit}" i tråd med prisfilen.`)
    }

    const filePrice = rowPrice(priceRow)
    const unitPriceNok = Number.isFinite(filePrice) ? filePrice : item.unitPriceNok

    // Prisendring var tidligere usynlig: enhet og kategori ble varslet, pris ikke.
    // Da kunne totalsummen flytte seg uten at noen fikk vite hvorfor.
    if (Number.isFinite(filePrice) && Math.abs(filePrice - item.unitPriceNok) >= 0.01) {
      warnings.push(
        `Prisen for "${item.title}" ble justert fra ${priceLabel(item.unitPriceNok)} til ${priceLabel(filePrice)} i tråd med prisfilen${
          priceRow.supplier_name?.trim() ? ` (${priceRow.supplier_name.trim()})` : ""
        }.`
      )
    }

    return {
      ...item,
      subproject: normalizedSubproject,
      unit: normalizedUnit,
      unitPriceNok,
      supplier: priceRow.supplier_name?.trim() || item.supplier,
      nobb: priceRow.nobb?.trim() || item.nobb,
      supplierSku: priceRow.supplier_sku?.trim() || item.supplierSku,
      priceSource: "prisfil" as const,
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
