import "server-only"

import { CANCELLATION_REASONS, cancellationReasonLabel } from "@/lib/billing/cancellation-reasons"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * - scheduled:  sagt opp, tilgangen løper ut perioden
 * - ended:      abonnementet er avsluttet
 * - resumed:    kunden angret og fortsetter
 * - discounted: valgte «For dyrt» og ble med 50 % av neste måned
 */
export type CancellationState = "scheduled" | "ended" | "resumed" | "discounted"

export type CancellationRow = {
  id: string
  created_at: string
  company_id: string | null
  company_name: string | null
  user_email: string | null
  reason: string
  reason_label: string
  detail: string | null
  plan_key: string | null
  billing_interval: string | null
  status_at_cancel: string | null
  subscribed_since: string | null
  cancel_at: string | null
  state: CancellationState
}

export type CancellationDashboard = {
  rows: CancellationRow[]
  reasons: Array<{ key: string; label: string; count: number }>
  summary: {
    total: number
    last30Days: number
    topReason: string | null
    resumed: number
    discounted: number
  }
  /** Satt når tabellen ikke kunne leses (typisk: db/110 er ikke kjørt). */
  loadError: string | null
}

const EMPTY: CancellationDashboard = {
  rows: [],
  reasons: [],
  summary: { total: 0, last30Days: 0, topReason: null, resumed: 0, discounted: 0 },
  loadError: null,
}

type BillingState = { status: string | null; cancel_at_period_end: boolean | null }

function resolveState(
  row: { outcome: string; resumed_at: string | null; company_id: string | null },
  billing: BillingState | undefined,
  isLatestForCompany: boolean
): CancellationState {
  if (row.outcome === "discount_accepted") return "discounted"
  if (row.resumed_at) return "resumed"
  // Firmaet er slettet, eller en eldre oppsigelse som ble fulgt av en ny.
  if (!row.company_id || !billing) return "ended"
  if (billing.status === "canceled") return "ended"
  if (!isLatestForCompany) return "resumed"
  if (billing.cancel_at_period_end) return "scheduled"
  // Aktivt abonnement uten planlagt oppsigelse: angret utenfor appen (Stripe).
  return "resumed"
}

/**
 * Oppsigelser med grunn for /sjefen/oppsigelser. Service role (tabellen er
 * RLS deny-all); kun plattformadmin når hit via sjefen-layouten.
 */
export async function fetchCancellationDashboard(limit = 500): Promise<CancellationDashboard> {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from("subscription_cancellations")
    .select(
      "id, created_at, company_id, company_name, user_id, reason, detail, outcome, plan_key, billing_interval, status_at_cancel, subscribed_since, cancel_at, resumed_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[fetchCancellationDashboard]", error.message)
    return { ...EMPTY, loadError: error.message }
  }

  const records = data ?? []
  const companyIds = Array.from(new Set(records.map((r) => r.company_id).filter(Boolean))) as string[]
  const userIds = Array.from(new Set(records.map((r) => r.user_id).filter(Boolean))) as string[]

  const [billingResult, usersResult] = await Promise.all([
    companyIds.length
      ? admin
          .from("company_billing")
          .select("company_id, status, cancel_at_period_end")
          .in("company_id", companyIds)
      : Promise.resolve({ data: [] as Array<BillingState & { company_id: string }> }),
    userIds.length
      ? admin.from("users").select("id, email").in("id", userIds)
      : Promise.resolve({ data: [] as Array<{ id: string; email: string | null }> }),
  ])

  const billingByCompany = new Map(
    (billingResult.data ?? []).map((b) => [String(b.company_id), b as BillingState])
  )
  const emailByUser = new Map((usersResult.data ?? []).map((u) => [String(u.id), u.email ?? null]))

  // Radene er sortert nyest først — første rad per firma er den gjeldende.
  const seenCompanies = new Set<string>()
  const rows: CancellationRow[] = records.map((r) => {
    const companyId = (r.company_id as string | null) ?? null
    const isLatest = companyId ? !seenCompanies.has(companyId) : true
    if (companyId && r.outcome === "canceled") seenCompanies.add(companyId)
    return {
      id: String(r.id),
      created_at: String(r.created_at),
      company_id: companyId,
      company_name: r.company_name ?? null,
      user_email: r.user_id ? (emailByUser.get(String(r.user_id)) ?? null) : null,
      reason: String(r.reason),
      reason_label: cancellationReasonLabel(String(r.reason)),
      detail: r.detail ?? null,
      plan_key: r.plan_key ?? null,
      billing_interval: r.billing_interval ?? null,
      status_at_cancel: r.status_at_cancel ?? null,
      subscribed_since: r.subscribed_since ?? null,
      cancel_at: r.cancel_at ?? null,
      state: resolveState(
        { outcome: String(r.outcome), resumed_at: r.resumed_at ?? null, company_id: companyId },
        companyId ? billingByCompany.get(companyId) : undefined,
        isLatest
      ),
    }
  })

  const counts = new Map<string, number>()
  for (const row of rows) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1)

  // Kjente grunner i katalogrekkefølge (også de med 0), deretter ukjente nøkler.
  const known = new Set<string>(CANCELLATION_REASONS.map((r) => r.key))
  const reasons = [
    ...CANCELLATION_REASONS.map((r) => ({ key: r.key as string, label: r.label, count: counts.get(r.key) ?? 0 })),
    ...Array.from(counts.entries())
      .filter(([key]) => !known.has(key))
      .map(([key, count]) => ({ key, label: key, count })),
  ].sort((a, b) => b.count - a.count)

  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  return {
    rows,
    reasons,
    summary: {
      total: rows.length,
      last30Days: rows.filter((r) => new Date(r.created_at).getTime() >= monthAgo).length,
      topReason: reasons[0]?.count ? reasons[0].label : null,
      resumed: rows.filter((r) => r.state === "resumed").length,
      discounted: rows.filter((r) => r.state === "discounted").length,
    },
    loadError: null,
  }
}
