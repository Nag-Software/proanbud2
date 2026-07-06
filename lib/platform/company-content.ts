import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"

// Per-company content fetchers for the /sjefen/firmaer/[id] drill-down.
// All queries run with the service-role client (RLS bypass) and are gated by
// requirePlatformAdmin in the sjefen layout.

function getAdmin() {
  return createAdminClient()
}

const LIST_LIMIT = 500

async function reportError(route: string, error: unknown) {
  console.error(route, error)
  await logServerError({
    message: `Kunne ikke hente firmainnhold (${route})`,
    error,
    source: "server",
    route,
  })
}

export type CompanyProjectRow = {
  id: string
  name: string
  status: string
  project_type: string | null
  start_date: string | null
  end_date: string | null
  budget_nok: number | null
  created_at: string
  customer_name: string | null
}

export type CompanyOfferRow = {
  id: string
  title: string
  status: string
  amount_nok: number
  created_at: string
  sent_at: string | null
  public_slug: string | null
  recipient_email: string | null
  customer_name: string | null
  project_name: string | null
}

export type CompanyContractRow = {
  id: string
  title: string
  status: string
  amount_nok: number | null
  invoice_status: string
  signed_at: string | null
  created_at: string
  offer_id: string
}

export type CompanyCustomerRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
  city: string | null
  org_number: string | null
  created_at: string
}

export type CompanyMessageRow = {
  id: string
  content: string
  sender_type: "company" | "customer"
  created_at: string
  read_at: string | null
  offer_id: string | null
  customer_name: string
}

export type CompanyDocumentRow = {
  id: string
  name: string
  item_type: string
  extension: string | null
  mime_type: string | null
  size_bytes: number | null
  provider: string
  created_at: string
  updated_at: string
  owner_name: string
}

export type CompanyTimeEntryRow = {
  id: string
  entry_date: string
  hours: number | null
  description: string | null
  status: string
  started_at: string | null
  ended_at: string | null
  user_name: string
  project_name: string | null
}

export type CompanyTaskRow = {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  created_at: string
  assignee_name: string | null
  project_name: string | null
}

export type CompanyCalendarEventRow = {
  id: string
  title: string
  starts_at: string
  ends_at: string
  project_name: string | null
}

export type CompanyDeviationRow = {
  id: string
  reference_number: string
  title: string
  type: string
  status: string
  created_at: string
  closed_at: string | null
  project_name: string | null
}

export type CompanyChecklistRow = {
  id: string
  name: string
  status: string
  created_at: string
  completed_at: string | null
  project_name: string | null
}

export type CompanyTripRow = {
  id: string
  trip_date: string
  from_address: string | null
  to_address: string | null
  distance_km: number
  amount_nok: number
  classification: string
  driver_name: string
  project_name: string | null
}

export type CompanyContentStats = {
  projects: number
  offers: number
  contracts: number
  customers: number
  messages: number
  unreadMessages: number
  documents: number
  timeEntries: number
  openTimeEntries: number
  tasks: number
  calendarEvents: number
  deviations: number
  openDeviations: number
  checklists: number
  trips: number
}

function relationName(value: unknown): string | null {
  if (!value) return null
  const relation = Array.isArray(value) ? value[0] : value
  return (relation as { name?: string } | null)?.name ?? null
}

async function fetchCompanyUserMap(companyId: string): Promise<Map<string, string>> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("users")
    .select("id, full_name")
    .eq("company_id", companyId)

  if (error) {
    await reportError("fetchCompanyUserMap", error)
    return new Map()
  }

  return new Map((data ?? []).map((row) => [String(row.id), String(row.full_name)]))
}

export async function fetchCompanyProjects(companyId: string): Promise<CompanyProjectRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("projects")
    .select(
      "id, name, status, project_type, start_date, end_date, budget_nok, created_at, customers(name)"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    await reportError("fetchCompanyProjects", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    status: String(row.status ?? "planning"),
    project_type: (row.project_type as string | null) ?? null,
    start_date: (row.start_date as string | null) ?? null,
    end_date: (row.end_date as string | null) ?? null,
    budget_nok: row.budget_nok != null ? Number(row.budget_nok) : null,
    created_at: String(row.created_at),
    customer_name: relationName(row.customers),
  }))
}

export async function fetchCompanyOffers(companyId: string): Promise<CompanyOfferRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("offers")
    .select(
      "id, title, status, amount_nok, created_at, sent_at, public_slug, recipient_email, customers(name), projects(name)"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    await reportError("fetchCompanyOffers", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    amount_nok: Number(row.amount_nok ?? 0),
    created_at: String(row.created_at),
    sent_at: (row.sent_at as string | null) ?? null,
    public_slug: (row.public_slug as string | null) ?? null,
    recipient_email: (row.recipient_email as string | null) ?? null,
    customer_name: relationName(row.customers),
    project_name: relationName(row.projects),
  }))
}

export async function fetchCompanyContracts(companyId: string): Promise<CompanyContractRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("contracts")
    .select("id, title, status, amount_nok, invoice_status, signed_at, created_at, offer_id")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    await reportError("fetchCompanyContracts", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    status: String(row.status),
    amount_nok: row.amount_nok != null ? Number(row.amount_nok) : null,
    invoice_status: String(row.invoice_status ?? "none"),
    signed_at: (row.signed_at as string | null) ?? null,
    created_at: String(row.created_at),
    offer_id: String(row.offer_id),
  }))
}

export async function fetchCompanyCustomers(companyId: string): Promise<CompanyCustomerRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("customers")
    .select("id, name, email, phone, city, org_number, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    await reportError("fetchCompanyCustomers", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    email: (row.email as string | null) ?? null,
    phone: (row.phone as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    org_number: (row.org_number as string | null) ?? null,
    created_at: String(row.created_at),
  }))
}

export async function fetchCompanyMessages(companyId: string): Promise<CompanyMessageRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("messages")
    .select("id, content, sender_type, created_at, read_at, offer_id, customers(name)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    await reportError("fetchCompanyMessages", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    content: String(row.content),
    sender_type: row.sender_type as "company" | "customer",
    created_at: String(row.created_at),
    read_at: (row.read_at as string | null) ?? null,
    offer_id: (row.offer_id as string | null) ?? null,
    customer_name: relationName(row.customers) ?? "Ukjent kunde",
  }))
}

export async function fetchCompanyDocuments(companyId: string): Promise<CompanyDocumentRow[]> {
  const admin = getAdmin()
  const userMap = await fetchCompanyUserMap(companyId)
  const userIds = Array.from(userMap.keys())

  if (userIds.length === 0) {
    return []
  }

  const { data, error } = await admin
    .from("document_items")
    .select(
      "id, user_id, provider, name, item_type, mime_type, extension, size_bytes, created_at, updated_at"
    )
    .in("user_id", userIds)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    await reportError("fetchCompanyDocuments", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    item_type: String(row.item_type),
    extension: (row.extension as string | null) ?? null,
    mime_type: (row.mime_type as string | null) ?? null,
    size_bytes: row.size_bytes != null ? Number(row.size_bytes) : null,
    provider: String(row.provider),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    owner_name: userMap.get(String(row.user_id)) ?? "Ukjent bruker",
  }))
}

export async function fetchCompanyTimeEntries(companyId: string): Promise<CompanyTimeEntryRow[]> {
  const [userMap, entriesRes] = await Promise.all([
    fetchCompanyUserMap(companyId),
    getAdmin()
      .from("time_entries")
      .select(
        "id, entry_date, hours, description, status, started_at, ended_at, user_id, projects(name)"
      )
      .eq("company_id", companyId)
      .order("entry_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
  ])

  if (entriesRes.error) {
    await reportError("fetchCompanyTimeEntries", entriesRes.error)
    return []
  }

  return (entriesRes.data ?? []).map((row) => ({
    id: String(row.id),
    entry_date: String(row.entry_date),
    hours: row.hours != null ? Number(row.hours) : null,
    description: (row.description as string | null) ?? null,
    status: String(row.status ?? "approved"),
    started_at: (row.started_at as string | null) ?? null,
    ended_at: (row.ended_at as string | null) ?? null,
    user_name: userMap.get(String(row.user_id)) ?? "Ukjent bruker",
    project_name: relationName(row.projects),
  }))
}

export async function fetchCompanyTasks(companyId: string): Promise<CompanyTaskRow[]> {
  const [userMap, tasksRes] = await Promise.all([
    fetchCompanyUserMap(companyId),
    getAdmin()
      .from("tasks")
      .select("id, title, status, priority, due_date, created_at, assigned_to, projects(name)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(LIST_LIMIT),
  ])

  if (tasksRes.error) {
    await reportError("fetchCompanyTasks", tasksRes.error)
    return []
  }

  return (tasksRes.data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    status: String(row.status ?? "todo"),
    priority: String(row.priority ?? "medium"),
    due_date: (row.due_date as string | null) ?? null,
    created_at: String(row.created_at),
    assignee_name: row.assigned_to ? (userMap.get(String(row.assigned_to)) ?? null) : null,
    project_name: relationName(row.projects),
  }))
}

export async function fetchCompanyCalendarEvents(
  companyId: string
): Promise<CompanyCalendarEventRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("calendar_events")
    .select("id, title, starts_at, ends_at, projects(name)")
    .eq("company_id", companyId)
    .order("starts_at", { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    await reportError("fetchCompanyCalendarEvents", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    title: String(row.title),
    starts_at: String(row.starts_at),
    ends_at: String(row.ends_at),
    project_name: relationName(row.projects),
  }))
}

export async function fetchCompanyDeviations(companyId: string): Promise<CompanyDeviationRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("deviations")
    .select("id, reference_number, title, type, status, created_at, closed_at, projects(name)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    await reportError("fetchCompanyDeviations", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    reference_number: String(row.reference_number),
    title: String(row.title),
    type: String(row.type),
    status: String(row.status),
    created_at: String(row.created_at),
    closed_at: (row.closed_at as string | null) ?? null,
    project_name: relationName(row.projects),
  }))
}

export async function fetchCompanyChecklists(companyId: string): Promise<CompanyChecklistRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("project_checklists")
    .select("id, name, status, created_at, completed_at, projects(name)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT)

  if (error) {
    await reportError("fetchCompanyChecklists", error)
    return []
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    status: String(row.status ?? "not_started"),
    created_at: String(row.created_at),
    completed_at: (row.completed_at as string | null) ?? null,
    project_name: relationName(row.projects),
  }))
}

export async function fetchCompanyTrips(companyId: string): Promise<CompanyTripRow[]> {
  const [userMap, tripsRes] = await Promise.all([
    fetchCompanyUserMap(companyId),
    getAdmin()
      .from("kjorebok_trips")
      .select(
        "id, trip_date, from_address, to_address, distance_km, amount_nok, classification, driver_user_id, projects(name)"
      )
      .eq("company_id", companyId)
      .order("trip_date", { ascending: false })
      .limit(LIST_LIMIT),
  ])

  if (tripsRes.error) {
    await reportError("fetchCompanyTrips", tripsRes.error)
    return []
  }

  return (tripsRes.data ?? []).map((row) => ({
    id: String(row.id),
    trip_date: String(row.trip_date),
    from_address: (row.from_address as string | null) ?? null,
    to_address: (row.to_address as string | null) ?? null,
    distance_km: Number(row.distance_km ?? 0),
    amount_nok: Number(row.amount_nok ?? 0),
    classification: String(row.classification ?? "business"),
    driver_name: userMap.get(String(row.driver_user_id)) ?? "Ukjent bruker",
    project_name: relationName(row.projects),
  }))
}

export async function fetchCompanyContentStats(companyId: string): Promise<CompanyContentStats> {
  const admin = getAdmin()
  const userMap = await fetchCompanyUserMap(companyId)
  const userIds = Array.from(userMap.keys())

  const count = (table: string) =>
    admin.from(table).select("id", { count: "exact", head: true }).eq("company_id", companyId)

  const [
    projects,
    offers,
    contracts,
    customers,
    messages,
    unreadMessages,
    documents,
    timeEntries,
    openTimeEntries,
    tasks,
    calendarEvents,
    deviations,
    openDeviations,
    checklists,
    trips,
  ] = await Promise.all([
    count("projects"),
    count("offers"),
    count("contracts"),
    count("customers"),
    count("messages"),
    admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("sender_type", "customer")
      .is("read_at", null),
    userIds.length > 0
      ? admin
          .from("document_items")
          .select("id", { count: "exact", head: true })
          .in("user_id", userIds)
      : Promise.resolve({ count: 0 }),
    count("time_entries"),
    admin
      .from("time_entries")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .not("started_at", "is", null)
      .is("ended_at", null),
    count("tasks"),
    count("calendar_events"),
    count("deviations"),
    admin
      .from("deviations")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .eq("status", "open"),
    count("project_checklists"),
    count("kjorebok_trips"),
  ])

  return {
    projects: projects.count ?? 0,
    offers: offers.count ?? 0,
    contracts: contracts.count ?? 0,
    customers: customers.count ?? 0,
    messages: messages.count ?? 0,
    unreadMessages: unreadMessages.count ?? 0,
    documents: documents.count ?? 0,
    timeEntries: timeEntries.count ?? 0,
    openTimeEntries: openTimeEntries.count ?? 0,
    tasks: tasks.count ?? 0,
    calendarEvents: calendarEvents.count ?? 0,
    deviations: deviations.count ?? 0,
    openDeviations: openDeviations.count ?? 0,
    checklists: checklists.count ?? 0,
    trips: trips.count ?? 0,
  }
}
