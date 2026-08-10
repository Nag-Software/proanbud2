// Veiledende markedspriser for materialer som ikke finnes i bedriftens egne
// prisfiler.
//
// Nettsøket som lå her er FJERNET med vilje: det plukket første tall foran «kr» i
// et søketreff-snippet og satte alltid enhet «stk». «Fri frakt over 1000 kr» ble
// dermed en enhetspris på 1000, og en pallpris ble lest som stykkpris. Det
// produserte selvsikre, gale tall i tilbud til kunder. En kuratert liste er liten,
// men den er i det minste riktig — og linjer bygget på den merkes som anslag.

import { matchNorwegianSupplierPrices } from "@/lib/tilbud/supplier-prices"

export type MaterialWebSearchHit = {
  product: string
  supplier: string
  unit: string
  unitPriceNok: number
  sourceUrl: string
  source: "catalog"
  query: string
}

export async function searchMaterialPricesForOffer(input: {
  title: string
  description: string
  sourceSummary?: string
  subprojects?: string[]
}): Promise<MaterialWebSearchHit[]> {
  const combined = `${input.title}\n${input.description}\n${input.sourceSummary ?? ""}`
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

  return Array.from(hits.values()).slice(0, 20)
}

export function formatMaterialSearchHitsForPrompt(hits: MaterialWebSearchHit[]) {
  if (hits.length === 0) {
    return {
      tilgjengelig: false,
      instruks:
        "Ingen veiledende markedspriser for dette oppdraget. Mangler produktet i bedriftens prisfil, skal du likevel bruke konkret produktnavn og et realistisk norsk markedsanslag — og skrive i reasoning at prisen er et anslag.",
      treff: [],
    }
  }

  return {
    tilgjengelig: true,
    instruks:
      "Veiledende markedspriser, IKKE bedriftens forhandlede priser. Bruk dem kun når produktet mangler i prisfilen, og skriv i reasoning at prisen er et anslag.",
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
