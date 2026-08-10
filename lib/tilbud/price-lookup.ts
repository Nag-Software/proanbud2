// Prisoppslag som verktøy for kalkyle-KI-en.
//
// Bakgrunnen: prisfilene ble tidligere presset inn i prompten på forhånd, innenfor
// et tegnbudsjett. En prisfil på 25 000 rader fikk plass til noen få prosent, og
// utvalget ble gjort av en nøkkelord-scorer FØR modellen hadde bestemt hvilke
// produkter den trengte. Fantes ikke raden i utvalget, fant modellen på et tall.
//
// Her snus det: modellen søker selv, når den vet hva den leter etter, og svarer
// med radId i stedet for et pristall. Prisen slås opp fra raden etterpå, så et
// beløp i tilbudet kan ikke være noe modellen har diktet opp.
//
// Radene ligger allerede i minnet i ruta (hele prisfilen lastes uansett), så et
// verktøykall koster ingen databaserunde.

import {
  rankCompanyPriceRowsForPicker,
  type CompanyPriceRow,
} from "@/lib/tilbud/company-price-utils"
import type { OfferLineItem } from "@/lib/tilbud/types"

export const PRICE_LOOKUP_TOOL_NAME = "sok_prisfil"

/** Funksjonsverktøy i Responses-API-format (flatt, ikke nøstet under `function`). */
export const PRICE_LOOKUP_TOOL = {
  type: "function",
  name: PRICE_LOOKUP_TOOL_NAME,
  description: [
    "Søk i bedriftens komplette prisfiler. Bruk dette for HVER materiallinje du vurderer,",
    "før du bestemmer pris. Søk på produkttype med dimensjon (f.eks. «gipsplate 13mm» eller",
    "«våtromsmembran»), ikke på hele oppdragsteksten. Får du ingen relevante treff, søk med",
    "et bredere ord før du konkluderer med at produktet mangler.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      sporring: {
        type: "string",
        description: "Produktet du leter etter, f.eks. «gipsplate 13mm» eller «membran våtrom».",
      },
      maksTreff: {
        type: "integer",
        description: "Antall treff du vil ha tilbake (1–25). Standard 8.",
      },
    },
    required: ["sporring", "maksTreff"],
    additionalProperties: false,
  },
  strict: true,
} as const

export type PriceLookupHit = {
  radId: string
  produkt: string
  enhet: string | null
  nettpris: number | null
  listepris: number | null
  leverandor: string | null
  nobb: string | null
  artikkelnr: string | null
  kategori: string | null
}

export type PriceRowIndex = {
  /** Antall rader som er søkbare. */
  size: number
  search: (query: string, limit?: number) => PriceLookupHit[]
  get: (radId: string) => CompanyPriceRow | null
}

const MAX_HITS = 25
const DEFAULT_HITS = 8

function hitFor(radId: string, row: CompanyPriceRow): PriceLookupHit {
  return {
    radId,
    produkt: row.product?.trim() || "",
    enhet: row.unit?.trim() || null,
    nettpris: row.net_price ?? null,
    listepris: row.list_price ?? null,
    leverandor: row.supplier_name?.trim() || null,
    nobb: row.nobb?.trim() || null,
    artikkelnr: row.supplier_sku?.trim() || null,
    kategori: row.category?.trim() || null,
  }
}

/**
 * Indekserer radene én gang og gir både søk og oppslag på radId.
 *
 * Søk og oppslag MÅ dele nøkler — hvis modellen får en radId den ikke kan slås
 * opp igjen på, faller linjen tilbake til anslag og hele poenget ryker. Derfor
 * eier denne funksjonen begge deler. Rader uten id (skal ikke skje, men fila kan
 * være lastet uten id-kolonnen) får en stabil posisjonsnøkkel.
 */
export function buildPriceRowIndex(rows: CompanyPriceRow[]): PriceRowIndex {
  const byId = new Map<string, CompanyPriceRow>()
  const idByRow = new Map<CompanyPriceRow, string>()

  rows.forEach((row, index) => {
    const id = row.id?.trim() || `rad-${index}`
    byId.set(id, row)
    idByRow.set(row, id)
  })

  return {
    size: byId.size,
    search(query, limit = DEFAULT_HITS) {
      const capped = Math.min(Math.max(Math.trunc(limit) || DEFAULT_HITS, 1), MAX_HITS)
      if (!query.trim()) return []

      // allowFallback: false — heller null treff enn tilfeldige rader modellen
      // kan komme til å velge fra.
      return rankCompanyPriceRowsForPicker(rows, query, capped, { allowFallback: false }).map((row) => {
        const id = idByRow.get(row)
        // Rangeringen returnerer rader fra samme array, så oppslaget treffer. Skulle
        // den en dag returnere kopier, er en tom radId bedre enn en id som ikke finnes.
        return hitFor(id ?? "", row)
      })
    },
    get(radId) {
      return byId.get(radId.trim()) ?? null
    },
  }
}

/** Linje slik den kommer fra modellen — med en transient referanse til prisraden. */
export type GeneratedLineItem = OfferLineItem & { prisRadId?: string }

/**
 * Bytter modellens pristall mot prisen på raden den refererte til.
 *
 * Dette er hele poenget med punkt 5: så lenge beløpet er noe modellen skriver,
 * kan det være oppdiktet uansett hvor god prompten er. Her blir beløpet et
 * oppslag. Refererer linjen ingen rad — eller en rad som ikke finnes — beholder
 * vi tallet, men merker linjen som anslag så den ikke ser verifisert ut.
 */
export function resolvePriceRowReferences(
  items: GeneratedLineItem[],
  index: PriceRowIndex
): { lineItems: OfferLineItem[]; warnings: string[] } {
  const warnings: string[] = []

  const lineItems = items.map((item) => {
    const { prisRadId, ...rest } = item
    if (!prisRadId?.trim()) return rest

    const row = index.get(prisRadId)
    if (!row) {
      warnings.push(
        `Fant ikke prisraden KI-en viste til for «${item.title}». Prisen står som anslag og bør kontrolleres.`
      )
      return { ...rest, priceSource: "anslag" as const }
    }

    const price = Number(row.net_price ?? row.list_price ?? Number.NaN)
    if (!Number.isFinite(price)) {
      warnings.push(`Prisraden for «${item.title}» mangler pris. Beløpet står som anslag.`)
      return { ...rest, priceSource: "anslag" as const }
    }

    if (Math.abs(price - item.unitPriceNok) >= 0.01) {
      warnings.push(
        `Prisen for «${item.title}» ble hentet fra prisfila: ${priceText(price)} (KI-en foreslo ${priceText(item.unitPriceNok)}).`
      )
    }

    return {
      ...rest,
      title: row.product?.trim() || rest.title,
      unit: row.unit?.trim() || rest.unit,
      supplier: row.supplier_name?.trim() || rest.supplier,
      nobb: row.nobb?.trim() || rest.nobb,
      supplierSku: row.supplier_sku?.trim() || rest.supplierSku,
      unitPriceNok: price,
      priceSource: "prisfil" as const,
    }
  })

  return { lineItems, warnings }
}

function priceText(value: number) {
  return `${value.toLocaleString("no-NO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kr`
}

export type PriceLookupArgs = { sporring?: unknown; maksTreff?: unknown }

/** Kjører ett verktøykall og returnerer svaret modellen skal få. */
export function runPriceLookup(index: PriceRowIndex, args: PriceLookupArgs) {
  const query = typeof args.sporring === "string" ? args.sporring : ""
  const limit = typeof args.maksTreff === "number" ? args.maksTreff : DEFAULT_HITS

  if (index.size === 0) {
    return {
      treff: [],
      merknad: "Bedriften har ingen prisfiler. Alle materialpriser blir anslag som må merkes som det.",
    }
  }

  const treff = index.search(query, limit)

  return {
    treff,
    merknad:
      treff.length === 0
        ? "Ingen treff. Prøv et bredere søkeord. Finnes produktet ikke, sett prisen som anslag og utelat prisRadId."
        : "Velg raden som passer best og sett prisRadId på linjen. Ikke skriv prisen selv — den hentes fra raden.",
  }
}
