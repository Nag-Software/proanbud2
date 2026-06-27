"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"
import { assertCompanyHasModule, companyHasModule } from "@/lib/billing/server-modules"
import {
  buildEmployeeSummaries,
  buildProjectSummaries,
  calculateSessionHours,
  type TimeEntryRow,
} from "@/lib/time-tracking"
import { completedEntriesQuery, fetchParticipantHours } from "@/lib/timeforing/participant-hours"
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
    await logServerError({
      message: "Kunne ikke hente aktiv arbeidsøkt",
      error,
      source: "action",
      route: "getActiveWorkSessionAction",
      context: { projectId, userId: user.id, companyId },
    })
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
    await logServerError({
      message: "Kunne ikke starte arbeidsøkt",
      error,
      source: "action",
      route: "startWorkSessionAction",
      context: { projectId, userId: user.id, companyId },
    })
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
    await logServerError({
      message: "Kunne ikke avslutte arbeidsøkt",
      error,
      source: "action",
      route: "stopWorkSessionAction",
      context: { projectId, userId: user.id, companyId, entryId: activeSession.id },
    })
    throw new Error("Kunne ikke avslutte arbeid")
  }

  revalidatePath(`/prosjekter/${projectId}`)
  revalidatePath("/min-bedrift/timeforing")
  return data
}

export async function addManualTimeEntryAction(
  projectId: string,
  input: { entryDate: string; startedAt: string; endedAt: string; description?: string }
) {
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

  const startedAt = new Date(input.startedAt)
  const endedAt = new Date(input.endedAt)

  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    throw new Error("Ugyldig tidspunkt")
  }

  const diffHours = (endedAt.getTime() - startedAt.getTime()) / (1000 * 60 * 60)
  if (diffHours <= 0) {
    throw new Error("Sluttid må være etter starttid")
  }
  if (diffHours > 24) {
    throw new Error("En arbeidsøkt kan ikke være lengre enn 24 timer")
  }

  const hours = Math.round(diffHours * 100) / 100
  if (hours <= 0) {
    throw new Error("Tidsrommet er for kort")
  }

  const entryDate = /^\d{4}-\d{2}-\d{2}$/.test(input.entryDate)
    ? input.entryDate
    : startedAt.toISOString().slice(0, 10)

  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      project_id: projectId,
      user_id: user.id,
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
    console.error("Error adding manual time entry:", error)
    await logServerError({
      message: "Kunne ikke lagre manuell timeføring",
      error,
      source: "action",
      route: "addManualTimeEntryAction",
      context: { projectId, userId: user.id, companyId },
    })
    throw new Error("Kunne ikke lagre timeføring")
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
    await logServerError({
      message: "Kunne ikke hente timeføringer for prosjekt",
      error,
      source: "action",
      route: "getProjectTimeEntriesAction",
      context: { projectId, userId: user.id, companyId, viewAll },
    })
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

  return fetchParticipantHours(supabase, projectId)
}

export async function getCompanyTimeOverviewAction() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      canViewAll: false,
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
    await logServerError({
      message: "Kunne ikke hente timeoversikt for bedrift",
      error,
      source: "action",
      route: "getCompanyTimeOverviewAction",
      context: { userId: user.id, companyId, canViewAll },
    })
    return {
      canViewAll,
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
    totalHours,
    entries,
    byProject: buildProjectSummaries(entries),
    byEmployee: buildEmployeeSummaries(entries),
  }
}
