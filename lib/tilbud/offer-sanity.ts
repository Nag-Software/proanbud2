// Rimelighetssjekk av en ferdig kalkyle, kjørt før den vises.
//
// Prinsipp: sjekkene skal være forankret i data vi faktisk har — bedriftens egne
// tall og referanseradene i normal_prices — ikke i bransjenormer jeg finner på.
// En advarsel som bygger på et oppdiktet tall er bare en ny måte å ta feil på.
//
// Sjekkene VARSLER, de retter aldri. Håndverkeren skal ta avgjørelsen; poenget er
// at han ikke oppdager en enhetstabbe først når kunden har signert.

import type { OfferLineItem } from "@/lib/tilbud/types"
import type { NormalPriceRow } from "@/lib/tilbud/normal-prices"

function lineTotal(item: OfferLineItem) {
  const gross = item.quantity * item.unitPriceNok * (1 + (item.markupPercent || 0) / 100)
  return gross * (1 - (item.discountPercent || 0) / 100)
}

function isServiceUnit(unit: string) {
  const normalized = unit.trim().toLowerCase()
  return normalized === "time" || normalized === "fastpris"
}

function priceLabel(value: number) {
  return `${Math.round(value).toLocaleString("no-NO")} kr`
}

/**
 * Enheter som beskriver en PAKNING, ikke en måleenhet. Klassisk feil: prisen
 * gjelder per pall/pakke, men mengden er regnet i kvadratmeter — da blir tilbudet
 * fort ti ganger for dyrt uten at noe ser galt ut ved første øyekast.
 */
const PACKAGING_UNITS = ["pk", "pakke", "pall", "eske", "kolli", "bunt", "rull", "sekk", "spann"]
const MEASURED_UNITS = ["m2", "m", "lm", "kvm"]

export type OfferSanityInput = {
  lineItems: OfferLineItem[]
  /** Areal fra oppdraget/3D-modellen, når det finnes. */
  areaM2?: number | null
  /** Referanserad for prosjekttypen (normal_prices), når den finnes. */
  normalPrice?: NormalPriceRow | null
}

/**
 * Returnerer advarsler som legges på kalkylens eksisterende warnings-liste.
 */
export function checkOfferSanity(input: OfferSanityInput): string[] {
  const warnings: string[] = []
  const items = input.lineItems.filter((item) => item.quantity > 0 && item.unitPriceNok > 0)
  if (items.length === 0) return warnings

  const total = items.reduce((sum, item) => sum + lineTotal(item), 0)
  if (total <= 0) return warnings

  // 1. Enhetstabbe: pakningspris ganget opp som om den var en måleenhet.
  for (const item of items) {
    const unit = item.unit.trim().toLowerCase()
    if (!PACKAGING_UNITS.includes(unit)) continue
    // En pakning kjøpes i hele, små antall. Tresifret antall pakker er nesten
    // alltid et areal eller en lengde som har havnet i feil felt.
    if (item.quantity >= 100) {
      warnings.push(
        `«${item.title}» har ${item.quantity} ${item.unit} — prisen gjelder per ${item.unit}, så kontroller at mengden ikke egentlig er et areal eller en lengde.`
      )
    }
  }

  // 2. Én MATERIALLINJE som dominerer totalen — ofte samme rotårsak som over.
  // Arbeid holdes utenfor med vilje: i en håndverksbedrift er 60–80 % arbeid
  // helt normalt, og en advarsel på hver eneste timelinje ville vært ren støy.
  const dominating = items.filter(
    (item) => !isServiceUnit(item.unit) && lineTotal(item) / total >= 0.4
  )
  for (const item of dominating) {
    const share = Math.round((lineTotal(item) / total) * 100)
    warnings.push(
      `«${item.title}» utgjør ${share} % av hele tilbudet (${priceLabel(lineTotal(item))}). Kontroller enhetspris og mengde.`
    )
  }

  // 3. Kvadratmeterpris mot referansespennet for prosjekttypen.
  const area = input.areaM2 && input.areaM2 > 0 ? input.areaM2 : null
  const reference = input.normalPrice
  if (area && reference && reference.unit === "m2") {
    const perM2 = total / area
    // Referansen er inkl. mva og komplett leveranse; kalkylen er eks. mva. Vi
    // varsler derfor bare på grove avvik, ikke på små forskjeller i nivå.
    if (perM2 < reference.price_low_nok * 0.5) {
      warnings.push(
        `Tilbudet gir ${priceLabel(perM2)} per m², mot ${priceLabel(reference.price_low_nok)}–${priceLabel(reference.price_high_nok)} som er vanlig for ${reference.project_type}. Sjekk om noe mangler i kalkylen.`
      )
    } else if (perM2 > reference.price_high_nok * 2) {
      warnings.push(
        `Tilbudet gir ${priceLabel(perM2)} per m², mot ${priceLabel(reference.price_low_nok)}–${priceLabel(reference.price_high_nok)} som er vanlig for ${reference.project_type}. Sjekk om en mengde eller enhetspris er for høy.`
      )
    }
  }

  // 4. Ingen arbeidslinjer i det hele tatt.
  const hasLabor = items.some((item) => isServiceUnit(item.unit))
  if (!hasLabor) {
    warnings.push("Kalkylen inneholder ingen arbeidslinjer — kontroller at arbeidstid ikke mangler.")
  }

  return warnings
}

/** Eksportert for test: hjelper å se hva som regnes som pakning/måleenhet. */
export const SANITY_UNITS = { PACKAGING_UNITS, MEASURED_UNITS }
