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
import { distanceToAreaMeters, haversineMeters, type AreaGeometry } from "@/lib/geo/point-in-polygon"

const TIMEFORING_MODULE = "timeforing" as const

// GPS-drift tolerance: a fix counts as on-site when it's inside the geofence or
// within this many metres of its edge.
const GEOFENCE_BUFFER_M = 10

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

// Worker-initiated clock-in confirmed by GPS: starts a session only when the
// fix is inside the project's geofence (real teig polygon, else a 100 m circle),
// with a tolerance buffer for GPS drift. A single location point is stored for
// the declared time-tracking purpose. If the project has no geofence yet, we
// still start the session (and record the fix) so the feature degrades safely.
export async function geofenceCheckInAction(
  projectId: string,
  lat: number,
  lng: number,
  accuracyM?: number | null,
  description?: string
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error("Du må være logget inn")
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Mangler gyldig posisjon")
  }

  const { companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId) {
    throw new Error("Kunne ikke hente bedriftsinformasjon")
  }
  await assertCompanyHasModule(companyId, TIMEFORING_MODULE, "Timeføring")

  // One active session per user (matches startWorkSessionAction).
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

  // Validate against the project's stored geofence, when one exists.
  const { data: gf } = await supabase
    .from("project_geofences")
    .select("geofence_kind, center_lat, center_lng, radius_m, polygon")
    .eq("project_id", projectId)
    .eq("company_id", companyId)
    .maybeSingle()

  if (gf) {
    const polygon = gf.polygon as AreaGeometry | null
    let outsideBy = Infinity // metres outside the allowed zone (0 = inside)
    if (gf.geofence_kind === "polygon" && polygon) {
      outsideBy = distanceToAreaMeters(lng, lat, polygon)
    } else if (gf.center_lat != null && gf.center_lng != null) {
      const dc = haversineMeters(lng, lat, gf.center_lng as number, gf.center_lat as number)
      outsideBy = Math.max(0, dc - ((gf.radius_m as number) ?? 100))
    }
    if (outsideBy > GEOFENCE_BUFFER_M) {
      throw new Error(
        `Du er ikke på byggeplassen${Number.isFinite(outsideBy) ? ` (~${Math.round(outsideBy)} m utenfor)` : ""}. Gå nærmere og prøv igjen.`
      )
    }
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
      source: "geofence",
      status: "pending",
      check_in_lat: lat,
      check_in_lng: lng,
      check_in_accuracy_m: Number.isFinite(Number(accuracyM)) ? Number(accuracyM) : null,
    })
    .select("id, project_id, user_id, started_at, ended_at, description, entry_date")
    .single()

  if (error) {
    await logServerError({
      message: "Kunne ikke stemple inn (geofence)",
      error,
      source: "action",
      route: "geofenceCheckInAction",
      context: { projectId, userId: user.id, companyId },
    })
    throw new Error("Kunne ikke stemple inn")
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

export type PendingApproval = {
  id: string
  projectId: string
  projectName: string
  userName: string
  entryDate: string
  startedAt: string | null
  endedAt: string | null
  hours: number | null
  source: string
  onSite: boolean
  autoClosed: boolean
}

/** Completed entries awaiting manager approval (geofence/auto check-ins). */
export async function getPendingApprovalsAction(): Promise<PendingApproval[]> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId || !(await hasTimeforingModule(companyId))) return []
  if (!canManageProjects(role)) return []

  const { data, error } = await supabase
    .from("time_entries")
    .select(
      "id, project_id, entry_date, started_at, ended_at, hours, source, check_in_lat, auto_closed, users(full_name, email), projects(name)"
    )
    .eq("company_id", companyId)
    .eq("status", "pending")
    .not("ended_at", "is", null)
    .order("ended_at", { ascending: false })
    .limit(200)

  if (error) {
    await logServerError({
      message: "Kunne ikke hente timer til godkjenning",
      error,
      source: "action",
      route: "getPendingApprovalsAction",
      context: { userId: user.id, companyId },
    })
    return []
  }

  return (data || []).map((r) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users
    const p = Array.isArray(r.projects) ? r.projects[0] : r.projects
    return {
      id: r.id as string,
      projectId: r.project_id as string,
      projectName: (p?.name as string) || "Ukjent prosjekt",
      userName: (u?.full_name as string) || (u?.email as string) || "Ukjent",
      entryDate: r.entry_date as string,
      startedAt: (r.started_at as string | null) ?? null,
      endedAt: (r.ended_at as string | null) ?? null,
      hours: (r.hours as number | null) ?? null,
      source: (r.source as string) || "manual",
      onSite: r.check_in_lat != null,
      autoClosed: r.auto_closed === true,
    }
  })
}

export type CompanyTrackingSettings = {
  autoCloseEnabled: boolean
  defaultShiftEnd: string | null // "HH:MM"
  maxSessionHours: number
}

export async function getCompanyTrackingSettingsAction(): Promise<CompanyTrackingSettings> {
  const fallback: CompanyTrackingSettings = {
    autoCloseEnabled: true,
    defaultShiftEnd: null,
    maxSessionHours: 10,
  }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return fallback

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId || !canManageProjects(role)) return fallback

  const { data } = await supabase
    .from("company_tracking_settings")
    .select("auto_close_enabled, default_shift_end, max_session_hours")
    .eq("company_id", companyId)
    .maybeSingle()

  if (!data) return fallback
  return {
    autoCloseEnabled: data.auto_close_enabled ?? true,
    defaultShiftEnd: data.default_shift_end ? String(data.default_shift_end).slice(0, 5) : null,
    maxSessionHours: (data.max_session_hours as number) ?? 10,
  }
}

export async function saveCompanyTrackingSettingsAction(input: CompanyTrackingSettings) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId || !canManageProjects(role)) {
    throw new Error("Du har ikke tilgang til disse innstillingene")
  }

  const shiftEnd =
    input.defaultShiftEnd && /^\d{2}:\d{2}$/.test(input.defaultShiftEnd)
      ? input.defaultShiftEnd
      : null
  const maxHours = Math.min(24, Math.max(1, Math.round(Number(input.maxSessionHours) || 10)))

  const { error } = await supabase.from("company_tracking_settings").upsert(
    {
      company_id: companyId,
      auto_close_enabled: Boolean(input.autoCloseEnabled),
      default_shift_end: shiftEnd,
      max_session_hours: maxHours,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" }
  )

  if (error) {
    await logServerError({
      message: "Kunne ikke lagre innstillinger for timeføring",
      error,
      source: "action",
      route: "saveCompanyTrackingSettingsAction",
      context: { userId: user.id, companyId },
    })
    throw new Error("Kunne ikke lagre innstillinger")
  }

  revalidatePath("/min-bedrift/timeforing")
  return { ok: true as const }
}

async function setTimeEntryStatus(entryId: string, status: "approved" | "rejected") {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { role, companyId } = await getEffectiveRole(supabase, user.id)
  if (!companyId || !canManageProjects(role)) {
    throw new Error("Du har ikke tilgang til å godkjenne timer")
  }

  const { error } = await supabase
    .from("time_entries")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("company_id", companyId)

  if (error) {
    await logServerError({
      message: "Kunne ikke endre godkjenningsstatus",
      error,
      source: "action",
      route: "setTimeEntryStatus",
      context: { userId: user.id, companyId, entryId, status },
    })
    throw new Error("Kunne ikke oppdatere status")
  }

  revalidatePath("/min-bedrift/timeforing")
}

export async function approveTimeEntryAction(entryId: string) {
  await setTimeEntryStatus(entryId, "approved")
}

export async function rejectTimeEntryAction(entryId: string) {
  await setTimeEntryStatus(entryId, "rejected")
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
