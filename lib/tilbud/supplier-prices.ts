export type SupplierPriceRow = {
  id: string
  supplier: string
  product: string
  unit: string
  unitPriceNok: number
  sourceUrl: string
  tags: string[]
}

const SUPPLIER_PRICE_CATALOG: SupplierPriceRow[] = [
  {
    id: "trevirke-c24-48x98",
    supplier: "Montér",
    product: "Konstruksjonsvirke C24 48x98 mm",
    unit: "lm",
    unitPriceNok: 52,
    sourceUrl: "https://www.monter.no",
    tags: ["trevirke", "stender", "tak", "vegg", "konstruksjon"],
  },
  {
    id: "gips-std-13mm",
    supplier: "Byggmakker",
    product: "Gipsplate standard 13 mm",
    unit: "stk",
    unitPriceNok: 118,
    sourceUrl: "https://www.byggmakker.no",
    tags: ["gips", "vegg", "tak", "plate"],
  },
  {
    id: "isolasjonsull-50mm",
    supplier: "MAXBO",
    product: "Mineralull 50 mm",
    unit: "m2",
    unitPriceNok: 89,
    sourceUrl: "https://www.maxbo.no",
    tags: ["isolasjon", "ull", "vegg", "tak"],
  },
  {
    id: "isolasjonsull-100mm",
    supplier: "MAXBO",
    product: "Mineralull 100 mm",
    unit: "m2",
    unitPriceNok: 134,
    sourceUrl: "https://www.maxbo.no",
    tags: ["isolasjon", "ull", "vegg", "tak"],
  },
  {
    id: "membran-vatrom",
    supplier: "Megaflis",
    product: "Smøremembran våtrom",
    unit: "spann",
    unitPriceNok: 849,
    sourceUrl: "https://www.megaflis.no",
    tags: ["bad", "baderom", "membran", "våtrom"],
  },
  {
    id: "flis-limestone-60x60",
    supplier: "Megaflis",
    product: "Flis 60x60",
    unit: "m2",
    unitPriceNok: 429,
    sourceUrl: "https://www.megaflis.no",
    tags: ["bad", "flis", "gulv", "vegg"],
  },
  {
    id: "flislim-flex",
    supplier: "OBS BYGG",
    product: "Flislim flex",
    unit: "sekk",
    unitPriceNok: 299,
    sourceUrl: "https://www.obsbygg.no",
    tags: ["bad", "flis", "lim"],
  },
  {
    id: "takstein-betong",
    supplier: "Byggmakker",
    product: "Takstein betong",
    unit: "stk",
    unitPriceNok: 18,
    sourceUrl: "https://www.byggmakker.no",
    tags: ["tak", "takstein", "roofing"],
  },
  {
    id: "undertak-duk",
    supplier: "Montér",
    product: "Undertaksduk diffusjonsåpen",
    unit: "m2",
    unitPriceNok: 95,
    sourceUrl: "https://www.monter.no",
    tags: ["tak", "undertak", "duk"],
  },
  {
    id: "lekter-30x48",
    supplier: "MAXBO",
    product: "Lekt 30x48 mm",
    unit: "lm",
    unitPriceNok: 22,
    sourceUrl: "https://www.maxbo.no",
    tags: ["tak", "lekt", "kledning"],
  },
  {
    id: "terrassebord-furu-28x120",
    supplier: "Byggmakker",
    product: "Terrassebord impregnert 28x120",
    unit: "lm",
    unitPriceNok: 44,
    sourceUrl: "https://www.byggmakker.no",
    tags: ["terrasse", "utvendig", "trevirke"],
  },
  {
    id: "betong-b30",
    supplier: "OBS BYGG",
    product: "Tørrbetong B30 25kg",
    unit: "sekk",
    unitPriceNok: 84,
    sourceUrl: "https://www.obsbygg.no",
    tags: ["betong", "støp", "grunn"],
  },
  {
    id: "armeringsnett-k131",
    supplier: "Montér",
    product: "Armeringsnett K131",
    unit: "stk",
    unitPriceNok: 499,
    sourceUrl: "https://www.monter.no",
    tags: ["betong", "armering", "grunn"],
  },
  {
    id: "vindsperre-duk",
    supplier: "Byggmakker",
    product: "Vindsperreduk",
    unit: "m2",
    unitPriceNok: 39,
    sourceUrl: "https://www.byggmakker.no",
    tags: ["vegg", "vindsperre", "duk"],
  },
  {
    id: "kledning-grunnet-19x148",
    supplier: "MAXBO",
    product: "Kledning grunnet 19x148",
    unit: "lm",
    unitPriceNok: 63,
    sourceUrl: "https://www.maxbo.no",
    tags: ["kledning", "vegg", "utvendig"],
  },
  {
    id: "parkett-ek-1stav",
    supplier: "OBS BYGG",
    product: "Parkett eik 1-stav",
    unit: "m2",
    unitPriceNok: 559,
    sourceUrl: "https://www.obsbygg.no",
    tags: ["gulv", "parkett", "innvendig"],
  },
]

const DEFAULT_TAG_GROUPS = [
  ["tak", "roofing"],
  ["bad", "baderom", "våtrom"],
  ["vegg", "kledning"],
  ["gulv", "parkett"],
]

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim()
}

export function getSupplierPriceCatalog() {
  return SUPPLIER_PRICE_CATALOG
}

export function matchNorwegianSupplierPrices(input: {
  description: string
  subprojects: string[]
}) {
  const normalizedDescription = normalizeText(input.description)
  const normalizedSubprojects = input.subprojects.map(normalizeText)

  const matches = SUPPLIER_PRICE_CATALOG.filter((row) => {
    const normalizedTags = row.tags.map(normalizeText)

    return normalizedTags.some((tag) => {
      return (
        normalizedDescription.includes(tag) ||
        normalizedSubprojects.some((subproject) => subproject.includes(tag) || tag.includes(subproject))
      )
    })
  })

  if (matches.length > 0) {
    return matches.slice(0, 20)
  }

  const fallback = DEFAULT_TAG_GROUPS.flatMap((group) =>
    SUPPLIER_PRICE_CATALOG.filter((item) => item.tags.some((tag) => group.includes(tag))).slice(0, 2)
  )

  return Array.from(new Map(fallback.map((row) => [row.id, row])).values()).slice(0, 12)
}
