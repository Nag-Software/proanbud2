"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { assertCompanyHasModule, companyHasModule } from "@/lib/billing/server-modules"
import {
  buildEmployeeSummaries,
  buildProjectSummaries,
  calculateSessionHours,
  type TimeEntryRow,
} from "@/lib/time-tracking"
import { canManageProjects, normalizeRole } from "@/lib/roles"

const TIMEFORING_MODULE = "timeforing" as const

async function getEffectiveRole(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: userRoleData } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId)
    .maybeSingle()

  const { data: userTableData } = await supabase
    .from("users")
    .select("role, company_id")
    .eq("id", userId)
    .maybeSingle()

  // @ts-expect-error Supabase nested relation typing
  const role = userRoleData?.roles?.name || userTableData?.role || null

  return {
    role,
    companyId: userTableData?.company_id || null,
  }
}

async function hasTimeforingModule(companyId: string | null): Promise<boolean> {
  if (!companyId) return false
  return companyHasModule(companyId, TIMEFORING_MODULE)
}

function canManageAllEntries(role: string | null): boolean {
  return canManageProjects(role) || normalizeRole(role) === "admin"
}

// Validerer at hours-input er et fornuftig tall (> 0 og <= 24)
function parseHoursInput(value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Ugyldig antall timer")
  }
  const rounded = Math.round(value * 100) / 100
  if (rounded <= 0 || rounded > 24) {
    throw new Error("Timer må være mellom 0,01 og 24")
  }
  return rounded
}

function parseEntryDate(value: string): string {
  const trimmed = (value || "").slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error("Ugyldig dato")
  }
  return trimmed
}

function completedEntriesQuery(supabase: Awaited<ReturnType<typeof createClient>>) {
  return supabase
    .from("time_entries")
    .select(
      "id, project_id, user_id, entry_date, hours, description, started_at, ended_at, created_at, users(full_name, email), projects(name)"
    )
    .not("ended_at", "is", null)
    .not("hours", "is", null)
}

export async function getActiveWorkSessionAction(projectId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { companyId } = await getEffectiveRole(supabase, user.id)
  if (!(await hasTimeforingModule(companyId))) return null

  const { data, error } = await supabase
    .from("time_entries")
    .select("id, project_id, user_id, started_at, ended_at, description, entry_date")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .is("ended_at", null)
    .maybeSingle()

  if (error) {
    console.error("Error fetching active session:", error)
    return null
  }

  return data
}

export async function startWorkSessionAction(projectId: string, description?: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  await assertCompanyHasModule(companyId, TIMEFORING_MODULE, "Timeføring")

  const { data: existingActive } = await supabase
    .from("time_entries")
    .select("id, project_id, projects(name)")
    .eq("user_id", user.id)
    .is("ended_at", null)
    .maybeSingle()

  if (existingActive) {
    if (existingActive.project_id === projectId) {
      throw new Error("Du har allerede en aktiv arbeidsøkt på dette prosjektet")
    }

    const project = Array.isArray(existingActive.projects)
      ? existingActive.projects[0]
      : existingActive.projects

    throw new Error(
      `Du har allerede en aktiv arbeidsøkt${project?.name ? ` på «${project.name}»` : ""}. Avslutt den først.`
    )
  }

  const now = new Date()
  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      project_id: projectId,
      user_id: user.id,
      company_id: companyId,
      entry_date: now.toISOString().slice(0, 10),
      started_at: now.toISOString(),
      description: description?.trim() || null,
      hours: null,
      ended_at: null,
    })
    .select("id, project_id, user_id, started_at, ended_at, description, entry_date")
    .single()

  if (error) {
    console.error("Error starting work session:", error)
    throw new Error("Kunne ikke starte arbeid")
  }

  revalidatePath(`/prosjekter/${projectId}`)
  revalidatePath("/min-bedrift/timeforing")
  return data
}

export async function stopWorkSessionAction(projectId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, TIMEFORING_MODULE, "Timeføring")

  const { data: activeSession, error: activeError } = await supabase
    .from("time_entries")
    .select("id, started_at")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .is("ended_at", null)
    .maybeSingle()

  if (activeError || !activeSession?.started_at) {
    throw new Error("Fant ingen aktiv arbeidsøkt å avslutte")
  }

  const endedAt = new Date()
  const hours = calculateSessionHours(activeSession.started_at, endedAt)

  const { data, error } = await supabase
    .from("time_entries")
    .update({
      ended_at: endedAt.toISOString(),
      hours,
      entry_date: endedAt.toISOString().slice(0, 10),
      updated_at: endedAt.toISOString(),
    })
    .eq("id", activeSession.id)
    .select("id, project_id, user_id, started_at, ended_at, hours, description, entry_date")
    .single()

  if (error) {
    console.error("Error stopping work session:", error)
    throw new Error("Kunne ikke avslutte arbeid")
  }

  revalidatePath(`/prosjekter/${projectId}`)
  revalidatePath("/min-bedrift/timeforing")
  return data
}

export async function getProjectTimeEntriesAction(projectId: string, viewAll = false) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { companyId } = await getEffectiveRole(supabase, user.id)
  if (!(await hasTimeforingModule(companyId))) return []

  let query = completedEntriesQuery(supabase)
    .eq("project_id", projectId)
    .order("ended_at", { ascending: false })

  if (!viewAll) {
    query = query.eq("user_id", user.id)
  }

  const { data, error } = await query

  if (error) {
    console.error("Error fetching project time entries:", error)
    return []
  }

  return (data || []) as TimeEntryRow[]
}

export async function getProjectParticipantHoursAction(projectId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!(await hasTimeforingModule(companyId))) return []
  if (!canManageProjects(role)) {
    return []
  }

  const { data, error } = await completedEntriesQuery(supabase)
    .eq("project_id", projectId)
    .order("ended_at", { ascending: false })

  if (error) {
    console.error("Error fetching participant hours:", error)
    return []
  }

  return buildEmployeeSummaries((data || []) as TimeEntryRow[]).map((summary) => ({
    userId: summary.userId,
    name: summary.name,
    email: summary.email,
    totalHours: summary.totalHours,
    entryCount: summary.entryCount,
  }))
}

export async function getCompanyTimeOverviewAction() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      canViewAll: false,
      currentUserId: null as string | null,
      totalHours: 0,
      entries: [] as TimeEntryRow[],
      byProject: [],
      byEmployee: [],
    }
  }

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId || !(await hasTimeforingModule(companyId))) {
    return {
      canViewAll: false,
      currentUserId: user.id,
      totalHours: 0,
      entries: [] as TimeEntryRow[],
      byProject: [],
      byEmployee: [],
    }
  }

  const canViewAll = canManageProjects(role) || normalizeRole(role) === "admin"

  let query = completedEntriesQuery(supabase)
    .eq("company_id", companyId)
    .order("ended_at", { ascending: false })
    .limit(500)

  if (!canViewAll) {
    query = query.eq("user_id", user.id)
  }

  const { data, error } = await query

  if (error) {
    console.error("Error fetching company time overview:", error)
    return {
      canViewAll,
      currentUserId: user.id,
      totalHours: 0,
      entries: [] as TimeEntryRow[],
      byProject: [],
      byEmployee: [],
    }
  }

  const entries = (data || []) as TimeEntryRow[]
  const totalHours = entries.reduce((sum, entry) => sum + Number(entry.hours || 0), 0)

  return {
    canViewAll,
    currentUserId: user.id,
    totalHours,
    entries,
    byProject: buildProjectSummaries(entries),
    byEmployee: buildEmployeeSummaries(entries),
  }
}

type UpdateTimeEntryInput = {
  entryId: string
  entryDate?: string
  startedAt?: string | null
  endedAt?: string | null
  hours?: number | null
  description?: string | null
}

export async function updateTimeEntryAction(input: UpdateTimeEntryInput) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, TIMEFORING_MODULE, "Timeføring")

  const { data: existing, error: fetchError } = await supabase
    .from("time_entries")
    .select("id, project_id, user_id, company_id, started_at, ended_at, entry_date")
    .eq("id", input.entryId)
    .maybeSingle()

  if (fetchError || !existing) {
    throw new Error("Fant ikke registreringen")
  }

  if (existing.company_id !== companyId) {
    throw new Error("Du har ikke tilgang til denne registreringen")
  }

  // Worker kan kun endre egne registreringer; manager/admin kan endre alle i bedriften
  if (!canManageAllEntries(role) && existing.user_id !== user.id) {
    throw new Error("Du kan kun endre dine egne registreringer")
  }

  if (!existing.ended_at) {
    throw new Error("En aktiv arbeidsøkt kan ikke redigeres. Avslutt den først.")
  }

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  }

  // To redigeringsmoduser: enten start/slutt (timer beregnes), eller timer direkte
  if (input.startedAt && input.endedAt) {
    const start = new Date(input.startedAt)
    const end = new Date(input.endedAt)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new Error("Ugyldig start- eller sluttidspunkt")
    }
    if (end.getTime() <= start.getTime()) {
      throw new Error("Sluttidspunkt må være etter starttidspunkt")
    }
    const hours = calculateSessionHours(start, end)
    updatePayload.started_at = start.toISOString()
    updatePayload.ended_at = end.toISOString()
    updatePayload.hours = hours
    updatePayload.entry_date = end.toISOString().slice(0, 10)
  } else if (input.hours !== undefined && input.hours !== null) {
    updatePayload.hours = parseHoursInput(input.hours)
    if (input.entryDate) {
      updatePayload.entry_date = parseEntryDate(input.entryDate)
    }
  } else if (input.entryDate) {
    updatePayload.entry_date = parseEntryDate(input.entryDate)
  }

  if (input.description !== undefined) {
    updatePayload.description = input.description?.trim() || null
  }

  const { data, error } = await supabase
    .from("time_entries")
    .update(updatePayload)
    .eq("id", input.entryId)
    .select("id, project_id, user_id, started_at, ended_at, hours, description, entry_date")
    .single()

  if (error) {
    console.error("Error updating time entry:", error)
    throw new Error("Kunne ikke lagre endringen")
  }

  revalidatePath(`/prosjekter/${existing.project_id}`)
  revalidatePath("/min-bedrift/timeforing")
  return data
}

export async function deleteTimeEntryAction(entryId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  await assertCompanyHasModule(companyId, TIMEFORING_MODULE, "Timeføring")

  const { data: existing, error: fetchError } = await supabase
    .from("time_entries")
    .select("id, project_id, user_id, company_id")
    .eq("id", entryId)
    .maybeSingle()

  if (fetchError || !existing) {
    throw new Error("Fant ikke registreringen")
  }

  if (existing.company_id !== companyId) {
    throw new Error("Du har ikke tilgang til denne registreringen")
  }

  if (!canManageAllEntries(role) && existing.user_id !== user.id) {
    throw new Error("Du kan kun slette dine egne registreringer")
  }

  const { error } = await supabase.from("time_entries").delete().eq("id", entryId)

  if (error) {
    console.error("Error deleting time entry:", error)
    throw new Error("Kunne ikke slette registreringen")
  }

  revalidatePath(`/prosjekter/${existing.project_id}`)
  revalidatePath("/min-bedrift/timeforing")
  return { success: true }
}

type ManualTimeEntryInput = {
  projectId: string
  entryDate: string
  hours: number
  description?: string | null
  userId?: string
}

export async function createManualTimeEntryAction(input: ManualTimeEntryInput) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error("Du må være logget inn")
  }

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }

  await assertCompanyHasModule(companyId, TIMEFORING_MODULE, "Timeføring")

  const entryDate = parseEntryDate(input.entryDate)
  const hours = parseHoursInput(input.hours)

  // Worker kan kun føre timer på seg selv; manager/admin kan føre på andre ansatte
  let targetUserId = user.id
  if (input.userId && input.userId !== user.id) {
    if (!canManageAllEntries(role)) {
      throw new Error("Du kan kun registrere timer på deg selv")
    }
    const { data: targetUser } = await supabase
      .from("users")
      .select("id, company_id")
      .eq("id", input.userId)
      .maybeSingle()
    if (!targetUser || targetUser.company_id !== companyId) {
      throw new Error("Ugyldig ansatt")
    }
    targetUserId = input.userId
  }

  // entry_date kl 12:00 lokalt -> brukes som syntetisk start/slutt for visning av periode
  const startedAt = new Date(`${entryDate}T12:00:00`)
  const endedAt = new Date(startedAt.getTime() + hours * 60 * 60 * 1000)

  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      project_id: input.projectId,
      user_id: targetUserId,
      company_id: companyId,
      entry_date: entryDate,
      started_at: startedAt.toISOString(),
      ended_at: endedAt.toISOString(),
      hours,
      description: input.description?.trim() || null,
    })
    .select("id, project_id, user_id, started_at, ended_at, hours, description, entry_date")
    .single()

  if (error) {
    console.error("Error creating manual time entry:", error)
    throw new Error("Kunne ikke registrere timer")
  }

  revalidatePath(`/prosjekter/${input.projectId}`)
  revalidatePath("/min-bedrift/timeforing")
  return data
}
