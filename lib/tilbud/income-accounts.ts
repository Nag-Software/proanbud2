import type { OfferLineItem } from "@/lib/tilbud/types"

/**
 * Inntektskonto per tilbudslinje.
 *
 * Fiken KREVER `incomeAccount` på hver fritekstlinje (linjer uten productId) — uten den
 * svarer API-et HTTP 400. Fiken sin egen tilbudsdialog lar deg velge mellom fire
 * kategorier, og vi speiler nøyaktig de fire her slik at håndverkeren kjenner seg
 * igjen. Vi eksponerer kategorier, ikke kontonumre: en tømrer skal slippe å vite at
 * «Tjeneste» betyr 3020.
 *
 * Kontokodene er VERIFISERT mot den faktiske kontoplanen hentet fra Fikens
 * /companies/{slug}/accounts (område 3000–3999), ikke gjettet.
 */
export type IncomeAccountCategory = "vare_videresalg" | "vare_egenprodusert" | "tjeneste" | "annet"

export const INCOME_ACCOUNT_CATEGORY_OPTIONS: Array<{ value: IncomeAccountCategory; label: string }> = [
  { value: "vare_videresalg", label: "Vare (for videresalg)" },
  { value: "vare_egenprodusert", label: "Vare (egenprodusert)" },
  { value: "tjeneste", label: "Tjeneste" },
  { value: "annet", label: "Annet" },
]

/**
 * Kontoen avhenger av om bedriften er mva-registrert:
 *   30xx = «høy mva-sats»       (mva-registrert, 25 %, vatType HIGH)
 *   32xx = «unntatt for mva»    (utenfor Merverdiavgiftsregisteret, vatType OUTSIDE)
 * Å bokføre et ikke-registrert salg på 3000 ville lagt utgående mva på et salg som
 * aldri hadde mva. 3900 «Annen driftsrelatert inntekt» finnes kun i én variant.
 *
 * NB: kontogruppen bestemmes av bedriftens `vatRegistered`, ALDRI av vatType. En
 * eksplisitt sats-override endrer satsen, ikke registreringsstatusen.
 */
const ACCOUNT_BY_CATEGORY: Record<IncomeAccountCategory, { vatRegistered: string; notVatRegistered: string }> = {
  vare_videresalg: { vatRegistered: "3000", notVatRegistered: "3200" },
  vare_egenprodusert: { vatRegistered: "3010", notVatRegistered: "3210" },
  tjeneste: { vatRegistered: "3020", notVatRegistered: "3220" },
  annet: { vatRegistered: "3900", notVatRegistered: "3900" },
}

export const DEFAULT_INCOME_ACCOUNT_CATEGORY: IncomeAccountCategory = "tjeneste"

export function isIncomeAccountCategory(value: unknown): value is IncomeAccountCategory {
  return typeof value === "string" && value in ACCOUNT_BY_CATEGORY
}

export function normalizeIncomeAccountCategory(value: unknown): IncomeAccountCategory | undefined {
  return isIncomeAccountCategory(value) ? value : undefined
}

/** Kategori + mva-status → Fikens kontokode. */
export function resolveIncomeAccountCode(
  category: IncomeAccountCategory | undefined,
  vatRegistered: boolean
): string {
  const entry = ACCOUNT_BY_CATEGORY[category || DEFAULT_INCOME_ACCOUNT_CATEGORY]
  return vatRegistered ? entry.vatRegistered : entry.notVatRegistered
}

// Enheter som i praksis betyr arbeidstid hos håndverkere.
const TIME_UNITS = new Set(["time", "timer", "t", "tim", "h", "dag", "dager", "døgn", "uke", "uker"])

/**
 * Gjett kategori ut fra det linja allerede vet om seg selv, så brukeren normalt slipper
 * å velge. Rekkefølgen er bevisst:
 *   1. Enhet som betyr tid          → Tjeneste
 *   2. Leverandør/varenummer satt   → Vare for videresalg (innkjøpt og videresolgt)
 *   3. Ellers                       → Tjeneste (håndverk selger mest arbeid)
 * «Egenprodusert» gjettes ALDRI — det er et regnskapsmessig skille bare bedriften selv
 * kan avgjøre, og feil gjetning der flytter inntekt til feil konto.
 */
export function inferIncomeAccountCategory(item: Partial<OfferLineItem>): IncomeAccountCategory {
  const unit = String(item.unit || "").trim().toLowerCase()
  if (TIME_UNITS.has(unit)) {
    return "tjeneste"
  }

  const hasSupplierIdentity = Boolean(
    String(item.supplier || "").trim() ||
      String(item.supplierSku || "").trim() ||
      String(item.nobb || "").trim()
  )
  if (hasSupplierIdentity) {
    return "vare_videresalg"
  }

  return DEFAULT_INCOME_ACCOUNT_CATEGORY
}

/** Eksplisitt valg vinner alltid over gjetningen. */
export function effectiveIncomeAccountCategory(item: Partial<OfferLineItem>): IncomeAccountCategory {
  return normalizeIncomeAccountCategory(item.incomeAccountCategory) || inferIncomeAccountCategory(item)
}
