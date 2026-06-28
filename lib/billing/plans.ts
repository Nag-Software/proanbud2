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

export const PLAN_PRICING: Record<
  PlanKey,
  Record<BillingInterval, { monthlyNok: number; yearlyTotalNok: number }>
> = {
  mini: {
    month: { monthlyNok: 229, yearlyTotalNok: 229 * 12 },
    year: { monthlyNok: 189, yearlyTotalNok: 189 * 12 },
  },
  proff: {
    month: { monthlyNok: 499, yearlyTotalNok: 499 * 12 },
    year: { monthlyNok: 419, yearlyTotalNok: 419 * 12 },
  },
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
    description: "Koble til Tripletex, DocuSign m.m. Outlook og Google Drive er alltid gratis.",
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

export const SEAT_PRICE_NOK = 39

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

export function getStripePriceId(plan: PlanKey, interval: BillingInterval): string {
  const envKey = PRICE_ENV_KEYS[`${plan}-${interval}`]
  const priceId = process.env[envKey]?.trim()
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
function resolveIntervalPriceId(base: string, interval: BillingInterval): string {
  const intervalKey = PRICE_ENV_KEYS[`${base}-${interval}`]
  const intervalId = intervalKey ? process.env[intervalKey]?.trim() : undefined
  if (intervalId) return intervalId

  const monthKey = PRICE_ENV_KEYS[`${base}-month`]
  const monthId = monthKey ? process.env[monthKey]?.trim() : undefined
  if (monthId) return monthId

  throw new Error(`${monthKey ?? base} mangler i miljøvariabler`)
}

export function getModulePriceId(
  module: ModuleKey,
  interval: BillingInterval = "month"
): string {
  return resolveIntervalPriceId(`module-${module}`, interval)
}

export function getSeatPriceId(interval: BillingInterval = "month"): string {
  return resolveIntervalPriceId("seat", interval)
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
// Proff = "lever jobben": adds the compliance bundle (HMS/KS/avvik), calendar,
// project tasks, messaging and integrations.
//
// This is separate from the à-la-carte MODULE system (timeforing/dokumenter
// stay independent add-ons on BOTH plans). `integrasjoner` is special: it is
// included in Proff AND still purchasable as a module on Mini — see hasFeature.
// ---------------------------------------------------------------------------

export type FeatureKey =
  | "hms"
  | "ks"
  | "avvik"
  | "kalender"
  | "project_tasks"
  | "meldinger"
  | "meldinger_ki"
  | "integrasjoner"

export const PLAN_FEATURES: Record<PlanKey, FeatureKey[]> = {
  mini: [],
  proff: ["hms", "ks", "avvik", "kalender", "project_tasks", "meldinger", "meldinger_ki", "integrasjoner"],
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
  meldinger: "meldinger_ki",
  meldinger_ki: "meldinger_ki",
}

/** Modules whose value is already bundled into Proff — shown as "Inkludert i Proff". */
export const MODULES_INCLUDED_IN_PROFF: ModuleKey[] = ["integrasjoner", "meldinger_ki"]

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
}

/**
 * Human-facing summary of what Proff includes beyond Mini — drives the
 * "dette følger med"-panels in the billing page, onboarding and (mirrored)
 * the marketing site. Compliance keys are bundled into one display line.
 */
export const PROFF_INCLUDED_FEATURES: Array<{
  key: FeatureKey
  label: string
  description: string
}> = [
  { key: "hms", label: "HMS, KS og avvik", description: "HMS-håndbok, KS-sjekklister og avvikshåndtering." },
  { key: "kalender", label: "Kalender", description: "Delt kalender med Google- og Outlook-synk." },
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
    description: "Tripletex, Fiken og DocuSign uten ekstra modulkostnad.",
  },
]
