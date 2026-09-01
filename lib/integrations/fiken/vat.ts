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

/** Default Norwegian construction VAT is 25% → HIGH (mva-registrert bedrift). */
export const DEFAULT_FIKEN_VAT_TYPE: FikenVatType = "HIGH"

/**
 * vatType for en bedrift som IKKE står i Merverdiavgiftsregisteret.
 *
 * Det MÅ være `OUTSIDE` («utenfor merverdiavgiftsloven»), ikke `NONE`. Fiken avviser
 * alt annet med HTTP 400: «VAT charged when the company is not VAT registered. The only
 * VAT type accepted is OUTSIDE.» `NONE` betyr «0 % mva på et avgiftspliktig salg» og
 * forutsetter at bedriften ER registrert — en helt annen situasjon.
 */
export const NON_VAT_REGISTERED_FIKEN_VAT_TYPE: FikenVatType = "OUTSIDE"

/**
 * Bedriftens mva-status → Fikens vatType.
 *
 * `override` er `fiken_connections.default_vat_type`. Den bestemmer HVILKEN sats som
 * sendes, men sier ingenting om bedriftens registreringsstatus — den er et faktum om
 * bedriften, ikke et valg på integrasjonen. Derfor må vatRegistered ALDRI utledes fra
 * vatType (og særlig ikke via `vatType !== "NONE"`, som ville lest OUTSIDE som
 * «registrert» og valgt feil inntektskontogruppe).
 */
export function resolveFikenVatType(
  vatRegistered: boolean,
  override?: string | null
): FikenVatType {
  const configured = override?.trim()
  if (configured) {
    return configured as FikenVatType
  }
  return vatRegistered ? DEFAULT_FIKEN_VAT_TYPE : NON_VAT_REGISTERED_FIKEN_VAT_TYPE
}
