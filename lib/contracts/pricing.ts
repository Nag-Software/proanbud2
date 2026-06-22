import type {
  OfferLineItem,
  OfferPaymentScheduleEntry,
  OfferPricingModel,
} from "@/lib/tilbud/types"

export const DEFAULT_PAYMENT_SCHEDULE: OfferPaymentScheduleEntry[] = [
  { label: "Ved oppstart", percent: 30, dueDescription: "Ved kontraktsinngåelse" },
  { label: "Under arbeid", percent: 40, dueDescription: "Ved halvtid" },
  { label: "Ved ferdigstillelse", percent: 30, dueDescription: "Ved overtakelse" },
]

export const PRICING_MODEL_LABELS: Record<OfferPricingModel, string> = {
  fixed: "Fastpris",
  time_materials: "Regningsarbeid",
  unit_price: "Enhetspris",
  mixed: "Kombinasjon",
}

export const CONTRACT_BASIS_LABELS = {
  ns8405: "Basert på NS 8405",
  ns8407: "Basert på NS 8407",
  custom: "Egen avtale",
  none: "Ingen standard",
} as const

export function inferPricingModelFromLineItems(lineItems: OfferLineItem[]): OfferPricingModel {
  if (lineItems.length === 0) return "fixed"

  const units = lineItems.map((item) => String(item.unit || "").toLowerCase())
  const allFastpris = units.every((unit) => unit === "fastpris")
  if (allFastpris) return "fixed"

  const hasFastpris = units.some((unit) => unit === "fastpris")
  const hasHourly = units.some((unit) => ["time", "timer", "t", "hour", "hours"].includes(unit))
  if (hasFastpris && hasHourly) return "mixed"
  if (hasHourly) return "time_materials"

  const hasQuantityVariety = lineItems.some((item) => Number(item.quantity || 0) !== 1)
  if (hasQuantityVariety) return "unit_price"

  return "fixed"
}
