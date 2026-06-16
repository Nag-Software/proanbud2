import { createAdminClient } from "@/lib/supabase/admin"
import type {
  SelgerActivityRow,
  SelgerCompanyFilters,
  SelgerCompanyListRow,
  SelgerDashboardStats,
  SelgerEmailLogRow,
  SellerContactStatus,
  SelgerTimelineEntry,
} from "@/lib/selger/types"
import { sellerActionLabels } from "@/lib/selger/types"

function getAdmin() {
  return createAdminClient()
}

async function loadCompanyNames(ids: string[]) {
  if (ids.length === 0) return new Map<string, string>()
  const admin = getAdmin()
  const { data } = await admin.from("companies").select("id, name").in("id", ids)
  return new Map((data ?? []).map((row) => [row.id, row.name]))
}

async function loadSellerEmails(userIds: string[]) {
  if (userIds.length === 0) return new Map<string, string>()
  const admin = getAdmin()
  const { data } = await admin.from("users").select("id, email").in("id", userIds)
  return new Map((data ?? []).map((row) => [row.id, row.email]))
}

async function loadPrimaryContacts(companyIds: string[]) {
  if (companyIds.length === 0) return new Map<string, { name: string; email: string }>()
  const admin = getAdmin()
  const { data } = await admin
    .from("users")
    .select("company_id, full_name, email, role, created_at")
    .in("company_id", companyIds)
    .order("created_at", { ascending: true })

  const map = new Map<string, { name: string; email: string }>()
  for (const user of data ?? []) {
    if (!user.company_id || map.has(user.company_id)) continue
    if (user.role === "admin") {
      map.set(user.company_id, { name: user.full_name, email: user.email })
    }
  }
  for (const user of data ?? []) {
    if (!user.company_id || map.has(user.company_id)) continue
    map.set(user.company_id, { name: user.full_name, email: user.email })
  }
  return map
}

function mapCompanyRows(
  rows: Array<Record<string, unknown>>,
  contacts: Map<string, { name: string; email: string }>
): SelgerCompanyListRow[] {
  return rows.map((row) => {
    const users = row.users as { count: number }[] | undefined
    const billing = row.company_billing as
      | { status: string; plan_key: string | null }
      | { status: string; plan_key: string | null }[]
      | null
    const billingRow = Array.isArray(billing) ? billing[0] : billing
    const companyId = String(row.id)
    const contact = contacts.get(companyId)

    return {
      id: companyId,
      company_name: String(row.name),
      contact_name: contact?.name ?? null,
      email: (row.email as string | null) ?? contact?.email ?? null,
      phone: (row.phone as string | null) ?? null,
      plan_key: billingRow?.plan_key ?? null,
      billing_status: billingRow?.status ?? null,
      employee_count: users?.[0]?.count ?? 0,
      created_at: String(row.created_at),
      contact_status: ((row.seller_contact_status as SellerContactStatus) ?? "ukontaktet"),
      seller_last_contacted_at: (row.seller_last_contacted_at as string | null) ?? null,
    }
  })
}

export async function fetchSelgerCompaniesFiltered(
  filters: SelgerCompanyFilters = {}
): Promise<SelgerCompanyListRow[]> {
  const admin = getAdmin()
  const billingFilter = Boolean(filters.plan || filters.billingStatus)
  const billingRelation = billingFilter ? "company_billing!inner" : "company_billing"

  let query = admin
    .from("companies")
    .select(
      `id, name, email, phone, created_at, seller_contact_status, seller_last_contacted_at, users(count), ${billingRelation}(status, plan_key)`
    )

  if (filters.plan) {
    query = query.eq("company_billing.plan_key", filters.plan)
  }

  if (filters.billingStatus) {
    query = query.eq("company_billing.status", filters.billingStatus)
  }

  if (filters.contactStatus) {
    query = query.eq("seller_contact_status", filters.contactStatus)
  }

  if (filters.createdFrom) {
    query = query.gte("created_at", filters.createdFrom)
  }

  if (filters.createdTo) {
    query = query.lte("created_at", `${filters.createdTo}T23:59:59.999Z`)
  }

  if (filters.q?.trim()) {
    const escaped = filters.q.trim().replace(/[%_,]/g, "")
    if (escaped) {
      const term = `%${escaped}%`
      query = query.or(`name.ilike.${term},email.ilike.${term},org_number.ilike.${term}`)
    }
  }

  const { data, error } = await query.order("created_at", { ascending: false })

  if (error) {
    console.error("fetchSelgerCompaniesFiltered", error)
    return []
  }

  const companyIds = (data ?? []).map((row) => String(row.id))
  const contacts = await loadPrimaryContacts(companyIds)
  return mapCompanyRows(data ?? [], contacts)
}

export async function fetchSelgerDashboardStats(): Promise<SelgerDashboardStats> {
  const admin = getAdmin()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

  const [total, proff, uncontacted, new7d] = await Promise.all([
    admin.from("companies").select("id", { count: "exact", head: true }),
    admin
      .from("company_billing")
      .select("id", { count: "exact", head: true })
      .eq("plan_key", "proff"),
    admin
      .from("companies")
      .select("id", { count: "exact", head: true })
      .eq("seller_contact_status", "ukontaktet"),
    admin
      .from("companies")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sevenDaysAgo),
  ])

  return {
    totalCompanies: total.count ?? 0,
    proffSubscriptions: proff.count ?? 0,
    uncontacted: uncontacted.count ?? 0,
    newLast7Days: new7d.count ?? 0,
  }
}

export async function fetchSelgerCompany(companyId: string) {
  const admin = getAdmin()
  const { data: company, error } = await admin
    .from("companies")
    .select(
      "*, users(count), company_billing(status, plan_key, trial_ends_at, current_period_end)"
    )
    .eq("id", companyId)
    .maybeSingle()

  if (error || !company) {
    return null
  }

  const contacts = await loadPrimaryContacts([companyId])
  const contact = contacts.get(companyId)
  const users = company.users as { count: number }[] | undefined
  const billing = Array.isArray(company.company_billing)
    ? company.company_billing[0]
    : company.company_billing

  return {
    id: company.id as string,
    company_name: company.name as string,
    contact_name: contact?.name ?? null,
    email: (company.email as string | null) ?? contact?.email ?? null,
    phone: (company.phone as string | null) ?? null,
    org_number: (company.org_number as string | null) ?? null,
    created_at: company.created_at as string,
    contact_status: ((company.seller_contact_status as SellerContactStatus) ?? "ukontaktet"),
    seller_last_contacted_at: (company.seller_last_contacted_at as string | null) ?? null,
    employee_count: users?.[0]?.count ?? 0,
    plan_key: billing?.plan_key ?? null,
    billing_status: billing?.status ?? null,
    trial_ends_at: billing?.trial_ends_at ?? null,
    current_period_end: billing?.current_period_end ?? null,
  }
}

export async function fetchSelgerCompanyTimeline(companyId: string): Promise<SelgerTimelineEntry[]> {
  const admin = getAdmin()

  const [byTargetRes, byMetaRes, emailRes] = await Promise.all([
    admin
      .from("seller_activity_log")
      .select("id, action, metadata, created_at, seller_user_id")
      .eq("target_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("seller_activity_log")
      .select("id, action, metadata, created_at, seller_user_id")
      .contains("metadata", { companyId })
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("seller_email_log")
      .select("id, template_id, recipient_email, created_at, sent_by")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(100),
  ])

  const activityRows = [
    ...new Map(
      [...(byTargetRes.data ?? []), ...(byMetaRes.data ?? [])].map((row) => [row.id, row])
    ).values(),
  ]

  const sellerIds = [
    ...new Set([
      ...activityRows.map((row) => row.seller_user_id).filter(Boolean),
      ...(emailRes.data ?? []).map((row) => row.sent_by).filter(Boolean),
    ]),
  ] as string[]

  const sellerEmails = await loadSellerEmails(sellerIds)
  const entries: SelgerTimelineEntry[] = []

  for (const row of activityRows) {
    const metadata = (row.metadata as Record<string, unknown>) ?? {}
    entries.push({
      id: `activity-${row.id}`,
      kind: row.action === "phone_call" ? "call" : "activity",
      title: sellerActionLabels[row.action] ?? row.action,
      description:
        typeof metadata.recipientEmail === "string"
          ? metadata.recipientEmail
          : typeof metadata.note === "string"
            ? metadata.note
            : null,
      created_at: row.created_at,
      seller_email: row.seller_user_id ? sellerEmails.get(row.seller_user_id) ?? null : null,
    })
  }

  for (const row of emailRes.data ?? []) {
    entries.push({
      id: `email-${row.id}`,
      kind: "email",
      title: `E-post: ${row.template_id}`,
      description: row.recipient_email,
      created_at: row.created_at,
      seller_email: row.sent_by ? sellerEmails.get(row.sent_by) ?? null : null,
    })
  }

  return entries.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

export async function fetchSelgerUnifiedActivity(limit = 200): Promise<SelgerActivityRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("seller_activity_log")
    .select("id, action, target_type, target_id, metadata, created_at, seller_user_id")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("fetchSelgerUnifiedActivity", error)
    return []
  }

  const companyIds = [
    ...new Set(
      (data ?? [])
        .map((row) => {
          if (row.target_type === "company" && row.target_id) return row.target_id
          const meta = row.metadata as Record<string, unknown>
          return typeof meta.companyId === "string" ? meta.companyId : null
        })
        .filter(Boolean)
    ),
  ] as string[]

  const [companyNames, sellerEmails] = await Promise.all([
    loadCompanyNames(companyIds),
    loadSellerEmails(
      [...new Set((data ?? []).map((row) => row.seller_user_id).filter(Boolean))] as string[]
    ),
  ])

  return (data ?? []).map((row) => {
    const meta = (row.metadata as Record<string, unknown>) ?? {}
    const companyId =
      row.target_type === "company" && row.target_id
        ? row.target_id
        : typeof meta.companyId === "string"
          ? meta.companyId
          : null

    return {
      id: row.id,
      action: row.action,
      target_type: row.target_type,
      target_id: row.target_id,
      company_id: companyId,
      company_name: companyId ? companyNames.get(companyId) ?? null : null,
      metadata: meta,
      created_at: row.created_at,
      seller_email: row.seller_user_id ? sellerEmails.get(row.seller_user_id) ?? null : null,
    }
  })
}

export async function fetchSelgerEmailLog(limit = 200): Promise<SelgerEmailLogRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("seller_email_log")
    .select("id, template_id, recipient_email, company_id, created_at, sent_by")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("fetchSelgerEmailLog", error)
    return []
  }

  const companyIds = [...new Set((data ?? []).map((row) => row.company_id).filter(Boolean))] as string[]
  const senderIds = [...new Set((data ?? []).map((row) => row.sent_by).filter(Boolean))] as string[]

  const [companyNames, sellerEmails] = await Promise.all([
    loadCompanyNames(companyIds),
    loadSellerEmails(senderIds),
  ])

  return (data ?? []).map((row) => ({
    id: row.id,
    template_id: row.template_id,
    recipient_email: row.recipient_email,
    company_id: row.company_id,
    company_name: row.company_id ? companyNames.get(row.company_id) ?? null : null,
    created_at: row.created_at,
    sent_by_email: row.sent_by ? sellerEmails.get(row.sent_by) ?? null : null,
  }))
}
