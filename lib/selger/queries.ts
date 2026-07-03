import { createAdminClient } from "@/lib/supabase/admin"
import { logServerError } from "@/lib/errors/log"
import type {
  PipelineLeadRow,
  ProspectTaskRow,
  ProspectTimelineEntry,
  SelgerActivityRow,
  SelgerCompanyFilters,
  SelgerCompanyListRow,
  SelgerDashboardStats,
  SelgerEmailLogRow,
  SellerContactStatus,
  SelgerTimelineEntry,
  TaskWithLead,
} from "@/lib/selger/types"
import { sellerActionLabels } from "@/lib/selger/types"
import { OPEN_PIPELINE_STATUSES, type ProspectRow, type ProspectStatus } from "@/lib/outreach/types"
import { PROSPECT_STATUS_LABELS } from "@/lib/outreach/types"
import { ensureProspectsForCompanies } from "@/lib/selger/sync"
import { isOptedOut } from "@/lib/outreach/send"

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
    await logServerError({
      message: "fetchSelgerCompaniesFiltered: kunne ikke hente firmaer",
      error,
      source: "server",
      route: "fetchSelgerCompaniesFiltered",
    })
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
    await logServerError({
      message: "fetchSelgerUnifiedActivity: kunne ikke hente aktivitetslogg",
      error,
      source: "server",
      route: "fetchSelgerUnifiedActivity",
    })
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

// ============================================================
// Pipeline (kanban) — prospects er den kanoniske «dealen»
// ============================================================

const PIPELINE_SELECT =
  "id, name, status, city, nace_description, email, phone, lead_score, is_hot, open_count, click_count, last_activity_at, stage_entered_at, hot_since, source, matched_company_id"

async function attachTasksAndBilling(
  admin: ReturnType<typeof createAdminClient>,
  rows: Array<Record<string, unknown>>
): Promise<PipelineLeadRow[]> {
  const ids = rows.map((r) => String(r.id))
  const matchedIds = rows.map((r) => r.matched_company_id).filter(Boolean) as string[]

  const [tasksRes, billingRes] = await Promise.all([
    ids.length
      ? admin
          .from("prospect_tasks")
          .select("id, prospect_id, task_type, title, due_at, done_at, note, created_at")
          .in("prospect_id", ids)
          .is("done_at", null)
      : Promise.resolve({ data: [] as ProspectTaskRow[] }),
    matchedIds.length
      ? admin
          .from("company_billing")
          .select("company_id, status, plan_key, trial_ends_at")
          .in("company_id", matchedIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
  ])

  const taskByProspect = new Map<string, ProspectTaskRow>()
  for (const task of (tasksRes.data ?? []) as ProspectTaskRow[]) {
    taskByProspect.set(task.prospect_id, task)
  }
  const billingByCompany = new Map<string, { status: string; plan_key: string | null; trial_ends_at: string | null }>()
  for (const row of (billingRes.data ?? []) as Array<Record<string, unknown>>) {
    billingByCompany.set(String(row.company_id), {
      status: String(row.status),
      plan_key: (row.plan_key as string | null) ?? null,
      trial_ends_at: (row.trial_ends_at as string | null) ?? null,
    })
  }

  return rows.map((row) => {
    const companyId = (row.matched_company_id as string | null) ?? null
    const billing = companyId ? billingByCompany.get(companyId) : undefined
    return {
      id: String(row.id),
      name: String(row.name),
      status: String(row.status),
      city: (row.city as string | null) ?? null,
      nace_description: (row.nace_description as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      lead_score: (row.lead_score as number | null) ?? 0,
      is_hot: Boolean(row.is_hot),
      open_count: (row.open_count as number | null) ?? 0,
      click_count: (row.click_count as number | null) ?? 0,
      last_activity_at: (row.last_activity_at as string | null) ?? null,
      stage_entered_at: (row.stage_entered_at as string | null) ?? null,
      hot_since: (row.hot_since as string | null) ?? null,
      source: String(row.source ?? "brreg"),
      matched_company_id: companyId,
      billing_status: billing?.status ?? null,
      plan_key: billing?.plan_key ?? null,
      trial_ends_at: billing?.trial_ends_at ?? null,
      open_task: taskByProspect.get(String(row.id)) ?? null,
    }
  })
}

/** Alle åpne pipeline-leads (kanban-kolonnene), med åpen oppgave + billing.
 *  Kjører trial-bro-synken først så selvregistrerte firmaer alltid er med. */
export async function fetchPipelineLeads(
  statuses: readonly string[] = OPEN_PIPELINE_STATUSES
): Promise<PipelineLeadRow[]> {
  const admin = getAdmin()
  await ensureProspectsForCompanies(admin)

  const { data, error } = await admin
    .from("prospects")
    .select(PIPELINE_SELECT)
    .in("status", statuses as string[])
    .order("lead_score", { ascending: false })
    .limit(500)

  if (error) {
    console.error("fetchPipelineLeads", error)
    await logServerError({
      message: "fetchPipelineLeads: kunne ikke hente pipeline",
      error,
      source: "server",
      route: "fetchPipelineLeads",
    })
    return []
  }

  return attachTasksAndBilling(admin, (data ?? []) as Array<Record<string, unknown>>)
}

/** Lukkede leads (Vunnet/Tapt) for egen visning. */
export async function fetchClosedLeads(limit = 100): Promise<PipelineLeadRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("prospects")
    .select(PIPELINE_SELECT)
    .in("status", ["kunde", "tapt"])
    .order("updated_at", { ascending: false })
    .limit(limit)

  if (error) return []
  return attachTasksAndBilling(admin, (data ?? []) as Array<Record<string, unknown>>)
}

// ============================================================
// Lead-record (detaljside)
// ============================================================

export type ProspectDetail = {
  prospect: ProspectRow
  billing: { status: string; plan_key: string | null; trial_ends_at: string | null } | null
  openTask: ProspectTaskRow | null
  /** Står e-posten/org.nr på suppresjonslisten? Da er e-post-kanalen stengt. */
  optedOut: boolean
  scoreReasons: string[]
}

export async function fetchProspectDetail(prospectId: string): Promise<ProspectDetail | null> {
  const admin = getAdmin()
  const { data: prospect, error } = await admin
    .from("prospects")
    .select("*")
    .eq("id", prospectId)
    .maybeSingle()

  if (error || !prospect) return null

  const [taskRes, billingRes, optedOut] = await Promise.all([
    admin
      .from("prospect_tasks")
      .select("id, prospect_id, task_type, title, due_at, done_at, note, created_at")
      .eq("prospect_id", prospectId)
      .is("done_at", null)
      .maybeSingle(),
    prospect.matched_company_id
      ? admin
          .from("company_billing")
          .select("status, plan_key, trial_ends_at")
          .eq("company_id", prospect.matched_company_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    isOptedOut(admin, {
      email: (prospect.email as string | null) ?? null,
      orgNumber: (prospect.org_number as string | null) ?? null,
    }),
  ])

  const reasons = Array.isArray(prospect.lead_score_reason)
    ? (prospect.lead_score_reason as string[])
    : []

  return {
    prospect: prospect as unknown as ProspectRow,
    billing: billingRes.data
      ? {
          status: String(billingRes.data.status),
          plan_key: (billingRes.data.plan_key as string | null) ?? null,
          trial_ends_at: (billingRes.data.trial_ends_at as string | null) ?? null,
        }
      : null,
    openTask: (taskRes.data as ProspectTaskRow | null) ?? null,
    optedOut,
    scoreReasons: reasons,
  }
}

const CALL_OUTCOME_LABELS: Record<string, string> = {
  svar_interessert: "Fikk svar — interessert",
  svar_ikke_interessert: "Fikk svar — ikke interessert",
  ikke_svar: "Ikke svar",
  beskjed: "La igjen beskjed",
  feil_nummer: "Feil nummer",
}

/** Samlet tidslinje for et lead: e-poster (m/ engasjement), samtaler, notater,
 *  statusskift, fullførte oppgaver og systemhendelser. App-side merge — samme
 *  mønster som fetchSelgerCompanyTimeline. */
export async function fetchProspectTimeline(prospectId: string): Promise<ProspectTimelineEntry[]> {
  const admin = getAdmin()

  const [activityRes, emailRes, tasksRes, prospectRes] = await Promise.all([
    admin
      .from("seller_activity_log")
      .select("id, action, metadata, created_at, seller_user_id")
      .eq("target_type", "prospect")
      .eq("target_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(200),
    admin
      .from("seller_email_log")
      .select(
        "id, template_id, recipient_email, subject, body, created_at, sent_by, opened_at, clicked_at, bounced_at"
      )
      .eq("prospect_id", prospectId)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("prospect_tasks")
      .select("id, task_type, title, note, done_at")
      .eq("prospect_id", prospectId)
      .not("done_at", "is", null)
      .order("done_at", { ascending: false })
      .limit(100),
    admin.from("prospects").select("created_at, source").eq("id", prospectId).maybeSingle(),
  ])

  const sellerIds = [
    ...new Set([
      ...(activityRes.data ?? []).map((r) => r.seller_user_id).filter(Boolean),
      ...(emailRes.data ?? []).map((r) => r.sent_by).filter(Boolean),
    ]),
  ] as string[]
  const sellerEmails = await loadSellerEmails(sellerIds)

  const entries: ProspectTimelineEntry[] = []

  for (const row of activityRes.data ?? []) {
    const meta = (row.metadata as Record<string, unknown>) ?? {}
    const sellerEmail = row.seller_user_id ? sellerEmails.get(row.seller_user_id) ?? null : null

    if (row.action === "phone_call") {
      const outcome = typeof meta.outcome === "string" ? meta.outcome : null
      entries.push({
        id: `activity-${row.id}`,
        kind: "call",
        title: outcome ? `Samtale — ${CALL_OUTCOME_LABELS[outcome] ?? outcome}` : "Samtale",
        description: typeof meta.note === "string" && meta.note ? meta.note : null,
        created_at: row.created_at,
        seller_email: sellerEmail,
      })
      continue
    }
    if (row.action === "note") {
      entries.push({
        id: `activity-${row.id}`,
        kind: "note",
        title: "Notat",
        description: typeof meta.note === "string" ? meta.note : null,
        created_at: row.created_at,
        seller_email: sellerEmail,
      })
      continue
    }
    if (
      row.action === "update_prospect_status" ||
      row.action === "qualify_prospect" ||
      row.action === "won_prospect" ||
      row.action === "lost_prospect"
    ) {
      const from = typeof meta.from === "string" ? meta.from : null
      const to = typeof meta.to === "string" ? meta.to : typeof meta.status === "string" ? meta.status : null
      const fromLabel = from ? (PROSPECT_STATUS_LABELS as Record<string, string>)[from] ?? from : null
      const toLabel = to ? (PROSPECT_STATUS_LABELS as Record<string, string>)[to] ?? to : null
      const lostReason = typeof meta.lostReason === "string" ? meta.lostReason : null
      entries.push({
        id: `activity-${row.id}`,
        kind: "status",
        title:
          fromLabel && toLabel
            ? `Flyttet: ${fromLabel} → ${toLabel}`
            : (sellerActionLabels[row.action] ?? row.action),
        description: lostReason
          ? `Årsak: ${lostReason}${typeof meta.note === "string" && meta.note ? ` — ${meta.note}` : ""}`
          : typeof meta.note === "string" && meta.note
            ? meta.note
            : null,
        created_at: row.created_at,
        seller_email: sellerEmail,
      })
      continue
    }
    entries.push({
      id: `activity-${row.id}`,
      kind: "system",
      title: sellerActionLabels[row.action] ?? row.action,
      description: typeof meta.note === "string" ? meta.note : null,
      created_at: row.created_at,
      seller_email: sellerEmail,
    })
  }

  for (const row of emailRes.data ?? []) {
    const historic = !row.sent_by && (row.template_id === "outreach-cold" || row.template_id === "outreach-followup")
    entries.push({
      id: `email-${row.id}`,
      kind: "email",
      title: historic
        ? `Automatisk utsendelse (historisk): ${row.subject ?? row.template_id}`
        : `E-post sendt: ${row.subject ?? row.template_id}`,
      description: row.recipient_email,
      created_at: row.created_at,
      seller_email: row.sent_by ? sellerEmails.get(row.sent_by) ?? null : null,
      email: {
        subject: (row.subject as string | null) ?? null,
        body: (row.body as string | null) ?? null,
        opened_at: (row.opened_at as string | null) ?? null,
        clicked_at: (row.clicked_at as string | null) ?? null,
        bounced_at: (row.bounced_at as string | null) ?? null,
        template_id: row.template_id,
      },
    })
  }

  for (const row of tasksRes.data ?? []) {
    entries.push({
      id: `task-${row.id}`,
      kind: "task",
      title: `Oppgave fullført: ${row.title || "Uten tittel"}`,
      description: (row.note as string | null) ?? null,
      created_at: row.done_at as string,
      seller_email: null,
    })
  }

  if (prospectRes.data) {
    entries.push({
      id: "system-created",
      kind: "system",
      title:
        prospectRes.data.source === "signup"
          ? "Registrerte seg selv (trial)"
          : prospectRes.data.source === "manual"
            ? "Lagt til manuelt"
            : "Importert fra Brønnøysundregistrene",
      description: null,
      created_at: prospectRes.data.created_at as string,
      seller_email: null,
    })
  }

  return entries.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )
}

// ============================================================
// «I dag»-køen
// ============================================================

export type TodayData = {
  /** Åpne oppgaver som forfaller i dag eller tidligere (forfalte først). */
  tasks: TaskWithLead[]
  /** Alle åpne pipeline-leads — signaler og råtner-liste beregnes fra disse. */
  leads: PipelineLeadRow[]
}

export async function fetchTodayData(): Promise<TodayData> {
  const admin = getAdmin()
  const endOfToday = new Date()
  endOfToday.setHours(23, 59, 59, 999)

  const [tasksRes, leads] = await Promise.all([
    admin
      .from("prospect_tasks")
      .select(
        "id, prospect_id, task_type, title, due_at, done_at, note, created_at, prospects(id, name, status, phone, email)"
      )
      .is("done_at", null)
      .lte("due_at", endOfToday.toISOString())
      .order("due_at", { ascending: true })
      .limit(100),
    fetchPipelineLeads(),
  ])

  const tasks: TaskWithLead[] = []
  for (const row of tasksRes.data ?? []) {
    const prospect = (Array.isArray(row.prospects) ? row.prospects[0] : row.prospects) as {
      id: string
      name: string
      status: string
      phone: string | null
      email: string | null
    } | null
    if (!prospect) continue
    tasks.push({
      id: row.id,
      prospect_id: row.prospect_id,
      task_type: row.task_type,
      title: row.title,
      due_at: row.due_at,
      done_at: row.done_at,
      note: row.note,
      created_at: row.created_at,
      prospect,
    })
  }

  return { tasks, leads }
}

// Re-eksportert så sidene slipper å importere fra to steder.
export type { ProspectStatus }

export async function fetchSelgerEmailLog(limit = 200): Promise<SelgerEmailLogRow[]> {
  const admin = getAdmin()
  const { data, error } = await admin
    .from("seller_email_log")
    .select("id, template_id, recipient_email, company_id, created_at, sent_by")
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("fetchSelgerEmailLog", error)
    await logServerError({
      message: "fetchSelgerEmailLog: kunne ikke hente e-postlogg",
      error,
      source: "server",
      route: "fetchSelgerEmailLog",
    })
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
