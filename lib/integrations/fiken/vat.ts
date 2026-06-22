import type { FikenVatType } from "@/lib/integrations/fiken/types"

/**
 * Map a Norwegian VAT percentage to Fiken's vatType enum.
 * HIGH=25% (standard), MEDIUM=15% (food), LOW=12% (transport/cinema etc.), 0%=NONE.
 *
 * ⚠️ The vatType enum is sent UPPERCASE per the Fiken spec description. The Swagger
 * example shows lowercase `high`; if the live API rejects uppercase, lowercase here.
 */
export function mapVatPercentToFikenVatType(percent: number | null | undefined): FikenVatType {
  const pct = Number.isFinite(percent) ? Number(percent) : 25

  if (pct >= 24) return "HIGH"
  if (pct >= 14) return "MEDIUM"
  if (pct >= 11) return "LOW"
  return "NONE"
}

export function fikenVatPercent(vatType: FikenVatType): number {
  switch (vatType) {
    case "HIGH":
      return 25
    case "MEDIUM":
      return 15
    case "LOW":
      return 12
    default:
      return 0
  }
}

/** Default Norwegian construction VAT is 25% → HIGH. */
export const DEFAULT_FIKEN_VAT_TYPE: FikenVatType = "HIGH"
