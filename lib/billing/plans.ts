export type PlanKey = "mini" | "proff"
export type BillingInterval = "month" | "year"
export type ModuleKey = "timeforing" | "dokumenter" | "integrasjoner" | "meldinger_ki" | "kjorebok"

export const TRIAL_DAYS = 14
export const OVERAGE_UNIT_NOK = 9.5
export const OVERAGE_UNIT_ORE = 950
/** Billable employee seats (manager/worker) included per plan. Admin is always free. */
export const INCLUDED_SEATS_BY_PLAN: Record<PlanKey, number> = {
  mini: 0,
  proff: 5,
}

export function includedSeatsForPlan(plan: PlanKey | null | undefined): number {
  if (!plan) return 0
  return INCLUDED_SEATS_BY_PLAN[plan] ?? 0
}

export function chargeableSeats(billableSeats: number, includedSeats: number): number {
  return Math.max(0, billableSeats - includedSeats)
}

export const PLAN_QUOTA_LIMITS: Record<PlanKey, number> = {
  mini: 20,
  proff: 100,
}

export const PLAN_LABELS: Record<PlanKey, string> = {
  mini: "Mini",
  proff: "Proff",
}

type PlanPricing = Record<
  PlanKey,
  Record<BillingInterval, { monthlyNok: number; yearlyTotalNok: number }>
>

/** Prisene for nye kunder fra 8. oktober 2026. */
export const PLAN_PRICING: PlanPricing = {
  mini: {
    month: { monthlyNok: 299, yearlyTotalNok: 299 * 12 },
    year: { monthlyNok: 249, yearlyTotalNok: 249 * 12 },
  },
  proff: {
    month: { monthlyNok: 690, yearlyTotalNok: 690 * 12 },
    year: { monthlyNok: 590, yearlyTotalNok: 590 * 12 },
  },
}

/** Prisene før 8. oktober 2026 — låst i 12 måneder for de som var med da. */
export const LEGACY_PLAN_PRICING: PlanPricing = {
  mini: {
    month: { monthlyNok: 229, yearlyTotalNok: 229 * 12 },
    year: { monthlyNok: 189, yearlyTotalNok: 189 * 12 },
  },
  proff: {
    month: { monthlyNok: 499, yearlyTotalNok: 499 * 12 },
    year: { monthlyNok: 419, yearlyTotalNok: 419 * 12 },
  },
}

/**
 * Prisøkningen 8. oktober 2026 kl. 15: bedrifter opprettet før dette beholder
 * de gamle prisene til låsen går ut ett år senere — men bare så lenge
 * abonnementet lever (se priceCohortForCompany). Kohorten styrer både hvilken
 * Stripe-pris som brukes og hvilket tall som vises.
 */
export type PriceCohort = "current" | "legacy"
export const LEGACY_SIGNUP_CUTOFF_MS = Date.parse("2026-10-08T15:00:00+02:00")
export const LEGACY_PRICE_LOCK_UNTIL_MS = Date.parse("2027-10-08T15:00:00+02:00")

export function priceCohortFor(
  companyCreatedAt: string | Date | null | undefined,
  now: Date = new Date()
): PriceCohort {
  if (now.getTime() >= LEGACY_PRICE_LOCK_UNTIL_MS) return "current"
  // Ukjent opprettelsesdato mens låsen gjelder: heller for lav pris til en ny
  // kunde enn for høy pris til en vi har lovet den gamle.
  if (!companyCreatedAt) return "legacy"
  const createdMs = new Date(companyCreatedAt).getTime()
  if (Number.isNaN(createdMs)) return "legacy"
  return createdMs < LEGACY_SIGNUP_CUTOFF_MS ? "legacy" : "current"
}

/**
 * Tilnærmet kohort uten Stripe-oppslag: prislåsen gjelder bare så lenge
 * bedriften har et levende abonnement (prøve, aktiv eller i purring). Brukes
 * der et Stripe-kall per bedrift er for dyrt (affiliate-metrikker). Alt som
 * viser eller setter en pris skal bruke getCompanyPriceCohort, som leser
 * abonnementets faktiske grunnpris — de to kan avvike for en bedrift opprettet
 * før prisøkningen som tegnet nytt abonnement til dagens pris.
 */
export function priceCohortForCompany(
  company: { createdAt: string | Date | null | undefined; billingStatus: string | null | undefined },
  now: Date = new Date()
): PriceCohort {
  if (!hasBillableAccess(company.billingStatus)) return "current"
  return priceCohortFor(company.createdAt, now)
}

/**
 * Kohorten et LEVENDE abonnement faktisk står på, lest av grunnplanens pris-ID.
 * Stripe er sannheten: en bedrift opprettet før prisøkningen som lot prøven
 * utløpe og tegnet nytt abonnement til dagens pris, skal vises og endres til
 * dagens pris — ikke flippe tilbake til gammel pris fordi statusen igjen er
 * «active». Returnerer null når pris-ID-en ikke er en kjent grunnplan.
 */
export function priceCohortFromBasePriceId(priceId: string | null | undefined): PriceCohort | null {
  if (!priceId) return null
  for (const plan of ["mini", "proff"] as const) {
    for (const interval of ["month", "year"] as const) {
      const envKey = PRICE_ENV_KEYS[`${plan}-${interval}`]
      if (process.env[`${envKey}_LEGACY`]?.trim() === priceId) return "legacy"
      if (process.env[envKey]?.trim() === priceId) return "current"
    }
  }
  return null
}

export function priceCohortFromSubscriptionItems(
  items: Array<{ price: { id: string; metadata?: Record<string, string> | null } }>
): PriceCohort | null {
  for (const item of items) {
    const kind = item.price.metadata?.kind
    if (kind && kind !== "base") continue
    const cohort = priceCohortFromBasePriceId(item.price.id)
    if (cohort) return cohort
  }
  return null
}

/** Kohorten en bedrift som registrerer seg akkurat nå havner i. */
export function newSignupCohort(now: Date = new Date()): PriceCohort {
  return priceCohortFor(now, now)
}

export function planPricingFor(cohort: PriceCohort): PlanPricing {
  return cohort === "legacy" ? LEGACY_PLAN_PRICING : PLAN_PRICING
}

export const MODULE_PRICING: Record<ModuleKey, number> = {
  timeforing: 39,
  dokumenter: 39,
  integrasjoner: 29,
  meldinger_ki: 29,
  kjorebok: 49,
}

/**
 * Catalog of optional, billable modules shown on the billing page.
 * The order here is the order they are rendered in the UI.
 */
export const MODULE_CATALOG: Array<{
  key: ModuleKey
  label: string
  description: string
  monthlyNok: number
}> = [
  {
    key: "timeforing",
    label: "Timeføring",
    description: "Registrer og følg opp timer på prosjekter og ansatte.",
    monthlyNok: MODULE_PRICING.timeforing,
  },
  {
    key: "dokumenter",
    label: "Proanbud Cloud",
    description: "Skylagring av dokumenter og filer i Proanbud Cloud.",
    monthlyNok: MODULE_PRICING.dokumenter,
  },
  {
    key: "meldinger_ki",
    label: "KI-svar i meldinger",
    description:
      "Få KI-forslag til svar på kundemeldinger med ett klikk — du godkjenner før det sendes. På Mini får du også selve meldingsinnboksen.",
    monthlyNok: MODULE_PRICING.meldinger_ki,
  },
  {
    key: "integrasjoner",
    label: "Integrasjoner",
    description: "Koble til Tripletex og Fiken. Google Kalender og Outlook er alltid gratis.",
    monthlyNok: MODULE_PRICING.integrasjoner,
  },
  {
    key: "kjorebok",
    label: "Kjørebok",
    description:
      "Før kjørebok med GPS eller manuelt — statens satser, kart og overføring til Tripletex som kjøregodtgjørelse.",
    monthlyNok: MODULE_PRICING.kjorebok,
  },
]

export const SEAT_PRICE_NOK = 69
export const LEGACY_SEAT_PRICE_NOK = 39

export function seatPriceNokFor(cohort: PriceCohort): number {
  return cohort === "legacy" ? LEGACY_SEAT_PRICE_NOK : SEAT_PRICE_NOK
}

export const PRICE_ENV_KEYS: Record<string, string> = {
  "mini-month": "STRIPE_PRICE_MINI_MONTHLY",
  "mini-year": "STRIPE_PRICE_MINI_YEARLY",
  "proff-month": "STRIPE_PRICE_PROFF_MONTHLY",
  "proff-year": "STRIPE_PRICE_PROFF_YEARLY",
  overage: "STRIPE_PRICE_OVERAGE",
  // Add-on prices have month + optional year variants. Seat/module items MUST
  // match the base subscription's interval or Stripe rejects the line item with
  // `prices_in_different_intervals`. The *_YEARLY vars are optional: when unset,
  // resolution falls back to the monthly price (correct for monthly companies).
  "module-timeforing-month": "STRIPE_PRICE_MODULE_TIMEFORING",
  "module-timeforing-year": "STRIPE_PRICE_MODULE_TIMEFORING_YEARLY",
  "module-dokumenter-month": "STRIPE_PRICE_MODULE_DOKUMENTER",
  "module-dokumenter-year": "STRIPE_PRICE_MODULE_DOKUMENTER_YEARLY",
  "module-integrasjoner-month": "STRIPE_PRICE_MODULE_INTEGRASJONER",
  "module-integrasjoner-year": "STRIPE_PRICE_MODULE_INTEGRASJONER_YEARLY",
  "module-meldinger_ki-month": "STRIPE_PRICE_MODULE_MELDINGER_KI",
  "module-meldinger_ki-year": "STRIPE_PRICE_MODULE_MELDINGER_KI_YEARLY",
  "module-kjorebok-month": "STRIPE_PRICE_MODULE_KJOREBOK",
  "module-kjorebok-year": "STRIPE_PRICE_MODULE_KJOREBOK_YEARLY",
  "seat-month": "STRIPE_PRICE_SEAT_EMPLOYEE",
  "seat-year": "STRIPE_PRICE_SEAT_EMPLOYEE_YEARLY",
}

/**
 * Legacy-kohorten leser `<NØKKEL>_LEGACY` (de gamle pris-ID-ene). Er den ikke
 * satt, brukes hovednøkkelen — så koden er trygg å deploye før variablene er
 * byttet i Vercel.
 */
function readPriceEnv(envKey: string | undefined, cohort: PriceCohort): string | undefined {
  if (!envKey) return undefined
  if (cohort === "legacy") {
    const legacyId = process.env[`${envKey}_LEGACY`]?.trim()
    if (legacyId) return legacyId
  }
  return process.env[envKey]?.trim() || undefined
}

export function getStripePriceId(
  plan: PlanKey,
  interval: BillingInterval,
  cohort: PriceCohort = "current"
): string {
  const envKey = PRICE_ENV_KEYS[`${plan}-${interval}`]
  const priceId = readPriceEnv(envKey, cohort)
  if (!priceId) {
    throw new Error(`${envKey} mangler i miljøvariabler`)
  }
  return priceId
}

/**
 * Price env vars required for the core subscription flow (base plans + overage +
 * seat). Module prices are validated lazily when a module is toggled. Returns the
 * list of MISSING keys so a misconfigured deploy can be detected up front (at the
 * checkout gate) instead of surfacing a raw 500 mid-flow.
 */
export function getMissingCorePriceEnvKeys(): string[] {
  const required = [
    "STRIPE_PRICE_MINI_MONTHLY",
    "STRIPE_PRICE_MINI_YEARLY",
    "STRIPE_PRICE_PROFF_MONTHLY",
    "STRIPE_PRICE_PROFF_YEARLY",
    "STRIPE_PRICE_OVERAGE",
    "STRIPE_PRICE_SEAT_EMPLOYEE",
  ]
  return required.filter((key) => !process.env[key]?.trim())
}

/**
 * 25 % MVA legges oppå alle priser (prisene er eks. mva). Satsen er et Stripe
 * TaxRate-objekt (eksklusiv) som settes som standard på abonnementet, så den
 * også treffer brukere, moduler og overforbruk på samme faktura. Uten
 * variabelen opprettes abonnementet uten MVA — som før.
 */
export function getMvaTaxRateIds(): string[] {
  const taxRateId = process.env.STRIPE_TAX_RATE_MVA?.trim()
  return taxRateId ? [taxRateId] : []
}

export function getOveragePriceId(): string {
  const priceId = process.env.STRIPE_PRICE_OVERAGE?.trim()
  if (!priceId) {
    throw new Error("STRIPE_PRICE_OVERAGE mangler i miljøvariabler")
  }
  return priceId
}

/**
 * Resolve a price env var for the given interval, falling back to the monthly
 * variant when the yearly one is not configured. Keeps monthly companies working
 * unchanged while letting yearly companies pick up interval-matched add-on prices
 * once the *_YEARLY vars are seeded.
 */
function resolveIntervalPriceId(
  base: string,
  interval: BillingInterval,
  cohort: PriceCohort = "current"
): string {
  const intervalKey = PRICE_ENV_KEYS[`${base}-${interval}`]
  const intervalId = readPriceEnv(intervalKey, cohort)
  if (intervalId) return intervalId

  const monthKey = PRICE_ENV_KEYS[`${base}-month`]
  const monthId = readPriceEnv(monthKey, cohort)
  if (monthId) return monthId

  throw new Error(`${monthKey ?? base} mangler i miljøvariabler`)
}

export function getModulePriceId(
  module: ModuleKey,
  interval: BillingInterval = "month"
): string {
  return resolveIntervalPriceId(`module-${module}`, interval)
}

export function getSeatPriceId(
  interval: BillingInterval = "month",
  cohort: PriceCohort = "current"
): string {
  return resolveIntervalPriceId("seat", interval, cohort)
}

export function quotaForPlan(planKey: PlanKey | null | undefined): number {
  if (!planKey) return 0
  return PLAN_QUOTA_LIMITS[planKey] ?? 0
}

/** Fully-paid / trialing — used where a strictly-good billing state is required. */
export function isActiveSubscriptionStatus(status: string | null | undefined): boolean {
  return status === "trialing" || status === "active"
}

/**
 * Grants APP ACCESS. Includes `past_due` so a company in card-retry dunning keeps
 * working during the grace period (Stripe retries the card for ~2-3 weeks) rather
 * than being locked out on the first failed charge. Use this for access/feature
 * gates; use isActiveSubscriptionStatus only where a fully-paid state matters.
 * Matches the "live subscription" set used by reconcile + the checkout guard.
 */
export function hasBillableAccess(status: string | null | undefined): boolean {
  return status === "trialing" || status === "active" || status === "past_due"
}

/**
 * Is the company in its free trial? During the trial EVERYTHING is unlocked —
 * every plan feature and every à-la-carte module — regardless of which plan was
 * chosen at signup or which modules have been added. This lets prospects try the
 * full product (Proff features + Kjørebok and all other modules) before the trial
 * converts to the plan/modules they actually pay for. Feature/module access gates
 * short-circuit to `true` on this; see companyHasModule / companyHasFeature /
 * requireModule (server) and useUserRole (client).
 */
export function isTrialStatus(status: string | null | undefined): boolean {
  return status === "trialing"
}

type PriceMetadata = Record<string, string> | null | undefined

export function planKeyFromPriceMetadata(metadata: PriceMetadata): PlanKey | null {
  const key = metadata?.plan_key
  if (key === "mini" || key === "proff") return key
  return null
}

export function intervalFromPriceMetadata(metadata: PriceMetadata): BillingInterval | null {
  const interval = metadata?.interval
  if (interval === "month" || interval === "year") return interval
  return null
}

// ---------------------------------------------------------------------------
// Plan feature gating (Mini vs Proff)
//
// Mini = "vinn jobben": tilbud, KI-tilbud, kunder, prosjekt-kjerne, priser.
// Proff = "lever jobben": adds the compliance bundle (HMS/KS/avvik),
// project tasks, messaging and integrations.
//
// `kalender` (the built-in Proanbud calendar) is included in EVERY plan, and
// the optional Google/Outlook connection on top of it is free — no module.
//
// This is separate from the à-la-carte MODULE system. `dokumenter` and
// `kjorebok` stay independent add-ons on BOTH plans. `integrasjoner`,
// `meldinger_ki` and `timeforing` are hybrids: included in Proff AND still
// purchasable as a module on Mini — see hasFeature + FEATURE_MODULE_FALLBACK.
// ---------------------------------------------------------------------------

export type FeatureKey =
  | "hms"
  | "timeforing"
  | "ks"
  | "avvik"
  | "kalender"
  | "project_tasks"
  | "meldinger"
  | "meldinger_ki"
  | "integrasjoner"

export const PLAN_FEATURES: Record<PlanKey, FeatureKey[]> = {
  mini: ["kalender"],
  proff: [
    "hms",
    "ks",
    "avvik",
    "kalender",
    "project_tasks",
    "meldinger",
    "meldinger_ki",
    "integrasjoner",
    "timeforing",
  ],
}

/**
 * Features that can ALSO be unlocked à la carte via a module on any plan.
 *
 * `meldinger_ki` is special: buying the module both unlocks the KI reply
 * suggestions AND the base `meldinger` feature, so Mini customers get a usable
 * customer-messaging inbox bundled with the KI add-on (Proff already includes
 * both via PLAN_FEATURES).
 */
const FEATURE_MODULE_FALLBACK: Partial<Record<FeatureKey, ModuleKey>> = {
  integrasjoner: "integrasjoner",
  timeforing: "timeforing",
  meldinger: "meldinger_ki",
  meldinger_ki: "meldinger_ki",
}

/** Modules whose value is already bundled into Proff — shown as "Inkludert i Proff". */
export const MODULES_INCLUDED_IN_PROFF: ModuleKey[] = ["integrasjoner", "meldinger_ki", "timeforing"]

/**
 * Pure resolver: does a company on `plan` owning `modules` have `feature`?
 * Used by both the server guard (assertPlanFeature) and the client hook
 * (useUserRole().hasFeature).
 */
export function hasFeature(
  plan: PlanKey | null | undefined,
  modules: Iterable<string>,
  feature: FeatureKey
): boolean {
  if (plan && PLAN_FEATURES[plan]?.includes(feature)) return true
  const fallbackModule = FEATURE_MODULE_FALLBACK[feature]
  if (fallbackModule) {
    for (const m of modules) {
      if (m === fallbackModule) return true
    }
  }
  return false
}

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  hms: "HMS",
  ks: "KS",
  avvik: "Avvik",
  kalender: "Kalender",
  project_tasks: "Oppgaver i prosjekter",
  meldinger: "Meldinger",
  meldinger_ki: "KI-svar i meldinger",
  integrasjoner: "Integrasjoner",
  timeforing: "Timeføring",
}

/**
 * Human-facing summary of what Proff includes beyond Mini — drives the
 * "dette følger med"-panels in the billing page, onboarding and (mirrored)
 * the marketing site. Compliance keys are bundled into one display line.
 */
/**
 * Kortversjonen av hver plan slik den vises i planvelgeren (betalingssiden og
 * onboarding). Proff-punktene speiler PROFF_INCLUDED_FEATURES; Mini-punktene er
 * «vinn jobben»-kjernen som alle planer har.
 */
export const PLAN_SUMMARIES: Record<
  PlanKey,
  { tagline: string; bullets: string[]; recommended: boolean }
> = {
  mini: {
    tagline: "Vinn jobben — tilbud, kunder og prosjekter.",
    bullets: [
      `${PLAN_QUOTA_LIMITS.mini} tilbud i måneden`,
      "Tilbud med KI-utkast og e-signering",
      "Kunder, prosjekter og prisfiler",
      "Kalender med Google og Outlook",
      "Ansatte koster ekstra per lisens",
    ],
    recommended: false,
  },
  proff: {
    tagline: "Lever jobben — alt i Mini pluss drift og dokumentasjon.",
    bullets: [
      `${PLAN_QUOTA_LIMITS.proff} tilbud i måneden`,
      `${INCLUDED_SEATS_BY_PLAN.proff} ansattlisenser inkludert`,
      "HMS, KS og avvik",
      "Timeføring og oppgaver i prosjekter",
      "Meldinger med KI-svar",
      "Tripletex og Fiken inkludert",
    ],
    recommended: true,
  },
}

export const PROFF_INCLUDED_FEATURES: Array<{
  key: FeatureKey
  label: string
  description: string
}> = [
  { key: "hms", label: "HMS, KS og avvik", description: "HMS-håndbok, KS-sjekklister og avvikshåndtering." },
  {
    key: "timeforing",
    label: "Timeføring inkludert",
    description: "Stemple inn og ut, og få timene rett på riktig prosjekt — uten modulkostnad.",
  },
  {
    key: "project_tasks",
    label: "Oppgaver i prosjekter",
    description: "Oppgavestyring og oppfølging på hvert prosjekt.",
  },
  {
    key: "meldinger",
    label: "Meldinger med KI-svar",
    description: "Meldingsinnboks og kundechat på tilbudsvisning — med KI-svarforslag på ett klikk.",
  },
  {
    key: "integrasjoner",
    label: "Integrasjoner inkludert",
    description: "Tripletex og Fiken uten ekstra modulkostnad.",
  },
]
