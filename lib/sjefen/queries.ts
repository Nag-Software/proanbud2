import { createAdminClient } from "@/lib/supabase/admin"
import type {
  SjefenCompanyRow,
  SjefenContractRow,
  SjefenMessageRow,
  SjefenOfferRow,
  SjefenOverviewStats,
  SjefenUserRow,
} from "@/lib/sjefen/types"

function getAdmin() {
  return createAdminClient()
}

export async function fetchSjefenOverview(): Promise<SjefenOverviewStats> {
  const admin = getAdmin()

  const [
    companiesRes,
    usersRes,
    offersRes,
    contractsRes,
    invoicesRes,
    messagesRes,
    unreadRes,
    billingRes,
    recentCompaniesRes,
    recentOffersRes,
    recentMessagesRes,
  ] = await Promise.all([
    admin.from("companies").select("id", { count: "exact", head: true }),
    admin.from("users").select("id, is_active", { count: "exact" }),
    admin.from("offers").select("id", { count: "exact", head: true }),
    admin.from("contracts").select("id", { count: "exact", head: true }),
    admin
      .from("contracts")
      .select("id", { count: "exact", head: true })
      .neq("invoice_status", "none"),
    admin.from("messages").select("id", { count: "exact", head: true }),
    admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("sender_type", "customer")
      .is("read_at", null),
    admin
      .from("company_billing")
      .select("status", { count: "exact", head: true })
      .in("status", ["active", "trialing"]),
    admin
      .from("companies")
      .select(
        "id, name, org_number, email, phone, created_at, users(count), offers(count), contracts(count), company_billing(status, plan_key)"
      )
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("offers")
      .select(
        "id, title, status, amount_nok, created_at, company_id, companies(name), customers(name), projects(name)"
      )
      .order("created_at", { ascending: false })
      .limit(8),
    admin
      .from("messages")
      .select(
        "id, content, sender_type, created_at, read_at, company_id, offer_id, companies(name), customers(name)"
      )
      .order("created_at", { ascending: false })
      .limit(8),
  ])

  const activeUsers =
    usersRes.data?.filter((user) => user.is_active !== false).length ?? 0

  return {
    companies: companiesRes.count ?? 0,
    users: usersRes.count ?? 0,
    activeUsers,
    offers: offersRes.count ?? 0,
    contracts: contractsRes.count ?? 0,
    invoices: invoicesRes.count ?? 0,
    messages: messagesRes.count ?? 0,
    unreadMessages: unreadRes.count ?? 0,
    activeSubscriptions: billingRes.count ?? 0,
    recentCompanies: mapCompanies(recentCompaniesRes.data ?? []),
    recentOffers: mapOffers(recentOffersRes.data ?? []),
    recentMessages: mapMessages(recentMessagesRes.data ?? []),
  }
}

export async function fetchSjefenCompanies(): Promise<SjefenCompanyRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("companies")
    .select(
      "id, name, org_number, email, phone, created_at, users(count), offers(count), contracts(count), company_billing(status, plan_key)"
    )
    .order("created_at", { ascending: false })

  if (error) {
    console.error("fetchSjefenCompanies", error)
    return []
  }

  return mapCompanies(data ?? [])
}

export async function fetchSjefenCompany(companyId: string) {
  const admin = getAdmin()

  const [companyRes, usersRes, billingRes, statsRes] = await Promise.all([
    admin.from("companies").select("*").eq("id", companyId).maybeSingle(),
    admin
      .from("users")
      .select("id, full_name, email, role, is_active, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    admin.from("company_billing").select("*").eq("company_id", companyId).maybeSingle(),
    Promise.all([
      admin.from("offers").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      admin.from("contracts").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      admin.from("customers").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      admin.from("projects").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      admin.from("messages").select("id", { count: "exact", head: true }).eq("company_id", companyId),
    ]),
  ])

  const [offers, contracts, customers, projects, messages] = statsRes

  return {
    company: companyRes.data,
    users: usersRes.data ?? [],
    billing: billingRes.data,
    stats: {
      offers: offers.count ?? 0,
      contracts: contracts.count ?? 0,
      customers: customers.count ?? 0,
      projects: projects.count ?? 0,
      messages: messages.count ?? 0,
    },
  }
}

export async function fetchSjefenUsers(): Promise<SjefenUserRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("users")
    .select("id, full_name, email, role, is_active, created_at, company_id, companies(name)")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("fetchSjefenUsers", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    is_active: row.is_active ?? true,
    created_at: row.created_at,
    company_id: row.company_id,
    // @ts-expect-error Supabase nested relation typing
    company_name: row.companies?.name ?? "Ukjent firma",
  }))
}

export async function fetchSjefenOffers(): Promise<SjefenOfferRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("offers")
    .select(
      "id, title, status, amount_nok, created_at, company_id, companies(name), customers(name), projects(name)"
    )
    .order("created_at", { ascending: false })

  if (error) {
    console.error("fetchSjefenOffers", error)
    return []
  }

  return mapOffers(data ?? [])
}

export async function fetchSjefenContracts(): Promise<SjefenContractRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("contracts")
    .select(
      "id, title, status, amount_nok, created_at, signed_at, company_id, offer_id, invoice_status, companies(name)"
    )
    .order("created_at", { ascending: false })

  if (error) {
    console.error("fetchSjefenContracts", error)
    return []
  }

  return mapContracts(data ?? [])
}

export async function fetchSjefenInvoices(): Promise<SjefenContractRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("contracts")
    .select(
      "id, title, status, amount_nok, created_at, signed_at, company_id, offer_id, invoice_status, invoice_external_id, invoice_external_url, invoice_sent_at, invoice_paid_at, companies(name)"
    )
    .neq("invoice_status", "none")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("fetchSjefenInvoices", error)
    return []
  }

  return mapContracts(data ?? [])
}

export async function fetchSjefenMessages(): Promise<SjefenMessageRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("messages")
    .select(
      "id, content, sender_type, created_at, read_at, company_id, offer_id, companies(name), customers(name)"
    )
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) {
    console.error("fetchSjefenMessages", error)
    return []
  }

  return mapMessages(data ?? [])
}

function mapCompanies(rows: Array<Record<string, unknown>>): SjefenCompanyRow[] {
  return rows.map((row) => {
    const users = row.users as { count: number }[] | undefined
    const offers = row.offers as { count: number }[] | undefined
    const contracts = row.contracts as { count: number }[] | undefined
    const billing = row.company_billing as
      | { status: string; plan_key: string | null }
      | { status: string; plan_key: string | null }[]
      | null

    const billingRow = Array.isArray(billing) ? billing[0] : billing

    return {
      id: String(row.id),
      name: String(row.name),
      org_number: (row.org_number as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      created_at: String(row.created_at),
      user_count: users?.[0]?.count ?? 0,
      offer_count: offers?.[0]?.count ?? 0,
      contract_count: contracts?.[0]?.count ?? 0,
      billing_status: billingRow?.status ?? null,
      plan_key: billingRow?.plan_key ?? null,
    }
  })
}

function mapOffers(rows: Array<Record<string, unknown>>): SjefenOfferRow[] {
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    amount_nok: Number(row.amount_nok ?? 0),
    created_at: String(row.created_at),
    company_id: String(row.company_id),
    // @ts-expect-error Supabase nested relation typing
    company_name: row.companies?.name ?? "Ukjent firma",
    // @ts-expect-error Supabase nested relation typing
    customer_name: row.customers?.name ?? null,
    // @ts-expect-error Supabase nested relation typing
    project_name: row.projects?.name ?? null,
  }))
}

function mapContracts(rows: Array<Record<string, unknown>>): SjefenContractRow[] {
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    amount_nok: row.amount_nok != null ? Number(row.amount_nok) : null,
    created_at: String(row.created_at),
    signed_at: (row.signed_at as string | null) ?? null,
    company_id: String(row.company_id),
    offer_id: String(row.offer_id),
    invoice_status: String(row.invoice_status ?? "none"),
    // @ts-expect-error Supabase nested relation typing
    company_name: row.companies?.name ?? "Ukjent firma",
  }))
}

function mapMessages(rows: Array<Record<string, unknown>>): SjefenMessageRow[] {
  return rows.map((row) => ({
    id: String(row.id),
    content: String(row.content),
    sender_type: row.sender_type as "company" | "customer",
    created_at: String(row.created_at),
    read_at: (row.read_at as string | null) ?? null,
    company_id: String(row.company_id),
    offer_id: (row.offer_id as string | null) ?? null,
    // @ts-expect-error Supabase nested relation typing
    company_name: row.companies?.name ?? "Ukjent firma",
    // @ts-expect-error Supabase nested relation typing
    customer_name: row.customers?.name ?? "Ukjent kunde",
  }))
}
