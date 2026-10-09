import "server-only"

import { unstable_cache } from "next/cache"

import { logServerError } from "@/lib/errors/log"
import {
  computeKpis,
  isCompedNow,
  isPayingNow,
  markTrialConversionsAcrossSubscriptions,
  monthlyRows,
  payingSince,
  toSubscriptionRecord,
  type MonthRow,
  type SubscriptionFacts,
  type SubscriptionKpis,
  type SubscriptionRecord,
} from "@/lib/sjefen/subscription-metrics"
import { getStripe, isStripeConfigured } from "@/lib/stripe/server"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Henting og sammenkobling for /sjefen/abonnement: Stripe-abonnementene
 * (cachet 5 min — én admin, én sidevisning av gangen) + bedriftsnavn, kilde
 * og first_paid_at fra databasen. Regnestykkene ligger i subscription-metrics.
 */

export type PayingCompanyRow = {
  subscription_id: string
  company_id: string | null
  company_name: string
  plan_key: string | null
  billing_interval: string | null
  status: string
  mrr_nok: number
  /** 100 % rabattert — lever, men betaler ingenting. */
  comped: boolean
  paying_since: string | null
  cancel_at_period_end: boolean
  utm_source: string | null
}

export type SourceRow = {
  source: string
  companies: number
  trialing: number
  paying: number
}

export type SubscriptionDashboard = {
  /** null = Stripe kunne ikke hentes; KPI-ene under er da DB-tellinger. */
  kpis: SubscriptionKpis | null
  stripeError: string | null
  months: MonthRow[]
  /** Levende abonnementer (betalende først, så gratis). */
  paying: PayingCompanyRow[]
  sources: SourceRow[]
  dbCounts: { paying: number; trialing: number }
  generatedAt: string
}

async function listStripeSubscriptions(): Promise<SubscriptionRecord[]> {
  const stripe = getStripe()
  const now = Date.now()
  const records: SubscriptionRecord[] = []
  for await (const sub of stripe.subscriptions.list({
    status: "all",
    limit: 100,
    expand: ["data.discounts"],
  })) {
    records.push(toSubscriptionRecord(sub, now))
  }
  return records
}

const cachedStripeSubscriptions = unstable_cache(
  listStripeSubscriptions,
  ["sjefen-stripe-subscriptions"],
  { revalidate: 300 }
)

type CompanyMeta = {
  id: string
  name: string
  utm_source: string | null
  created_at: string
}

export async function fetchSubscriptionDashboard(): Promise<SubscriptionDashboard> {
  const admin = createAdminClient()
  const now = Date.now()

  const [billingRes, companiesRes] = await Promise.all([
    admin
      .from("company_billing")
      .select("company_id, stripe_customer_id, stripe_subscription_id, status, first_paid_at"),
    admin.from("companies").select("id, name, utm_source, created_at"),
  ])

  // utm_source mangler (db/114 ikke kjørt) → hent uten kilde i stedet for tom side.
  let companies = (companiesRes.data ?? []) as CompanyMeta[]
  if (companiesRes.error?.code === "42703") {
    const { data } = await admin.from("companies").select("id, name, created_at")
    companies = ((data ?? []) as Array<Omit<CompanyMeta, "utm_source">>).map((row) => ({
      ...row,
      utm_source: null,
    }))
  }

  // first_paid_at kan også mangle — da faller vi tilbake på Stripe-heuristikken.
  type BillingMeta = {
    company_id: string
    stripe_customer_id: string | null
    stripe_subscription_id: string | null
    status: string | null
    first_paid_at?: string | null
  }
  let billingRows = (billingRes.data ?? []) as BillingMeta[]
  if (billingRes.error?.code === "42703") {
    const { data } = await admin
      .from("company_billing")
      .select("company_id, stripe_customer_id, stripe_subscription_id, status")
    billingRows = (data ?? []) as BillingMeta[]
  }

  const companyById = new Map(companies.map((c) => [c.id, c]))
  const billingByCompany = new Map(billingRows.map((b) => [b.company_id, b]))
  const companyByCustomer = new Map<string, string>()
  const companyBySubscription = new Map<string, string>()
  for (const b of billingRows) {
    if (b.stripe_customer_id) companyByCustomer.set(b.stripe_customer_id, b.company_id)
    if (b.stripe_subscription_id) companyBySubscription.set(b.stripe_subscription_id, b.company_id)
  }

  // DB kjenner ikke beløpet, så «betalende» her er status alene (inkl. gratis).
  const dbCounts = {
    paying: billingRows.filter((b) => b.status === "active" || b.status === "past_due").length,
    trialing: billingRows.filter((b) => b.status === "trialing").length,
  }

  const sources = sourcesLast30Days(companies, billingByCompany, now)

  if (!isStripeConfigured()) {
    return {
      kpis: null,
      stripeError: "Stripe er ikke konfigurert i dette miljøet.",
      months: [],
      paying: [],
      sources,
      dbCounts,
      generatedAt: new Date(now).toISOString(),
    }
  }

  let records: SubscriptionRecord[]
  try {
    records = await cachedStripeSubscriptions()
  } catch (error) {
    await logServerError({
      message: "Sjefen: kunne ikke hente abonnementer fra Stripe",
      error,
      level: "warning",
      source: "server",
      route: "fetchSubscriptionDashboard",
    })
    return {
      kpis: null,
      stripeError: error instanceof Error ? error.message : "Ukjent feil mot Stripe",
      months: [],
      paying: [],
      sources,
      dbCounts,
      generatedAt: new Date(now).toISOString(),
    }
  }

  type Facts = SubscriptionFacts & { resolvedCompanyId: string | null }
  const rawFacts: Facts[] = records.map(
    (record) => {
      const resolvedCompanyId =
        (record.companyId && companyById.has(record.companyId) ? record.companyId : null) ??
        companyBySubscription.get(record.id) ??
        (record.customerId ? companyByCustomer.get(record.customerId) : null) ??
        null
      const billing = resolvedCompanyId ? billingByCompany.get(resolvedCompanyId) : null
      const firstPaidAt = billing?.first_paid_at ? Date.parse(billing.first_paid_at) : null
      return {
        ...record,
        firstPaidAt: firstPaidAt && !Number.isNaN(firstPaidAt) ? firstPaidAt : null,
        resolvedCompanyId,
      }
    }
  )
  // Kortfri prøve → nytt abonnement via Checkout: konverteringen bor på
  // bedriften, ikke på prøve-abonnementet. Bedrift ukjent → Stripe-kunden.
  const facts = markTrialConversionsAcrossSubscriptions(
    rawFacts,
    (sub) => sub.resolvedCompanyId ?? sub.customerId,
    now
  )

  const paying: PayingCompanyRow[] = facts
    .filter((sub) => isPayingNow(sub) || isCompedNow(sub))
    .map((sub) => {
      const company = sub.resolvedCompanyId ? companyById.get(sub.resolvedCompanyId) : null
      const since = payingSince(sub, now)
      return {
        subscription_id: sub.id,
        company_id: sub.resolvedCompanyId,
        company_name: company?.name ?? "Ukjent bedrift",
        plan_key: sub.planKey,
        billing_interval: sub.interval,
        status: sub.status,
        mrr_nok: sub.mrrNok,
        comped: isCompedNow(sub),
        paying_since: since ? new Date(since).toISOString() : null,
        cancel_at_period_end: sub.cancelAtPeriodEnd,
        utm_source: company?.utm_source ?? null,
      }
    })
    .sort((a, b) => Number(a.comped) - Number(b.comped) || b.mrr_nok - a.mrr_nok)

  return {
    kpis: computeKpis(facts, now),
    stripeError: null,
    months: monthlyRows(facts, 6, now),
    paying,
    sources,
    dbCounts,
    generatedAt: new Date(now).toISOString(),
  }
}

function sourcesLast30Days(
  companies: CompanyMeta[],
  billingByCompany: Map<string, { status: string | null }>,
  now: number
): SourceRow[] {
  const cutoff = now - 30 * 24 * 60 * 60 * 1000
  const bySource = new Map<string, SourceRow>()
  for (const company of companies) {
    const created = Date.parse(company.created_at)
    if (Number.isNaN(created) || created < cutoff) continue
    const source = company.utm_source?.trim() || "(ukjent)"
    const row = bySource.get(source) ?? { source, companies: 0, trialing: 0, paying: 0 }
    row.companies += 1
    const status = billingByCompany.get(company.id)?.status ?? null
    if (status === "trialing") row.trialing += 1
    else if (status === "active" || status === "past_due") row.paying += 1
    bySource.set(source, row)
  }
  return [...bySource.values()].sort((a, b) => b.companies - a.companies)
}
