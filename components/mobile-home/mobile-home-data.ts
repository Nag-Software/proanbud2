import type { createClient } from "@/lib/supabase/client"

import { ACTIVE_PROJECT_STATUSES } from "@/app/prosjekter/project-utils"
import { fetchKpi } from "@/app/dashboard-kpi-data"
import { osloDateString } from "@/lib/timeforing/oslo-date"
import { unwrapRelation } from "@/lib/time-tracking"

type SupabaseClient = ReturnType<typeof createClient>

/**
 * Datalaget for appens hjem (components/mobile-home). Alt her er spørringer
 * som allerede finnes andre steder i produktet, bare satt sammen på nytt —
 * med ett unntak: «På plass nå» teller firmaets åpne timeøkter.
 *
 * Alle feil ender i tomme lister/nuller, aldri i et kast: hjemmet skal vise
 * det som gikk bra, og «Venter på deg» henter sitt eget.
 */

export type HomeProject = {
  id: string
  name: string
  status: string
  customer: string | null
}

export type PresenceRow = {
  id: string
  name: string
  project: string
  startedAt: string
}

export type ManagerHomeData = {
  /** Godkjente tilbud denne måneden, og forrige måned til sammenligning. */
  approvedMonth: number
  approvedPrevMonth: number | null
  openOffers: number
  openOffersSum: number
  presence: PresenceRow[]
  projects: HomeProject[]
  activeCount: number
}

export type WorkerSession = {
  id: string
  projectId: string
  projectName: string
  customer: string | null
  startedAt: string
}

export type WorkerHomeData = {
  session: WorkerSession | null
  /** Avsluttede timer per ukedag, mandag først. Den åpne økten legges til live i visningen. */
  weekHours: number[]
  projects: HomeProject[]
}

type ProjectRow = {
  id: string
  name: string
  status: string
  customers: { name: string } | { name: string }[] | null
}

function toHomeProject(row: ProjectRow): HomeProject {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    customer: unwrapRelation(row.customers)?.name ?? null,
  }
}

export async function loadManagerHome(supabase: SupabaseClient, companyId: string): Promise<ManagerHomeData> {
  const [kpi, openOffersRes, presenceRes, projectsRes, activeCountRes] = await Promise.all([
    fetchKpi(supabase, companyId, "omsetning", "month").catch(() => null),
    supabase.from("offers").select("amount_nok").eq("company_id", companyId).eq("status", "sent"),
    supabase
      .from("time_entries")
      .select("id, started_at, users(full_name), projects(name)")
      .eq("company_id", companyId)
      .is("ended_at", null)
      .not("started_at", "is", null)
      .order("started_at", { ascending: true })
      .limit(20),
    supabase
      .from("projects")
      .select("id, name, status, customers(name)")
      .eq("company_id", companyId)
      .in("status", [...ACTIVE_PROJECT_STATUSES])
      .order("updated_at", { ascending: false })
      .limit(3),
    supabase
      .from("projects")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .in("status", [...ACTIVE_PROJECT_STATUSES]),
  ])

  type PresenceRaw = {
    id: string
    started_at: string
    users: { full_name: string | null } | { full_name: string | null }[] | null
    projects: { name: string } | { name: string }[] | null
  }

  return {
    approvedMonth: kpi?.value ?? 0,
    approvedPrevMonth: kpi?.prev ?? null,
    openOffers: openOffersRes.data?.length ?? 0,
    openOffersSum: (openOffersRes.data ?? []).reduce((sum, row) => sum + (row.amount_nok || 0), 0),
    presence: ((presenceRes.data as PresenceRaw[] | null) ?? []).map((row) => ({
      id: row.id,
      name: unwrapRelation(row.users)?.full_name || "Ukjent",
      project: unwrapRelation(row.projects)?.name || "Ukjent prosjekt",
      startedAt: row.started_at,
    })),
    projects: ((projectsRes.data as ProjectRow[] | null) ?? []).map(toHomeProject),
    activeCount: activeCountRes.count ?? 0,
  }
}

/** Mandag i uken `date` er i, kl. 00:00 lokal tid. */
export function startOfWeek(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const offset = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - offset)
  return d
}

/** 0 = mandag … 6 = søndag, fra en `YYYY-MM-DD`-streng. */
export function weekdayIndex(entryDate: string): number {
  const [y, m, d] = entryDate.split("-").map(Number)
  return (new Date(y, m - 1, d).getDay() + 6) % 7
}

export async function loadWorkerHome(supabase: SupabaseClient, userId: string): Promise<WorkerHomeData> {
  const weekStart = osloDateString(startOfWeek(new Date()))

  const [sessionRes, weekRes, membersRes] = await Promise.all([
    supabase
      .from("time_entries")
      .select("id, project_id, started_at, projects(name, customers(name))")
      .eq("user_id", userId)
      .is("ended_at", null)
      .not("started_at", "is", null)
      .order("started_at", { ascending: false })
      .limit(1),
    supabase
      .from("time_entries")
      .select("hours, entry_date")
      .eq("user_id", userId)
      .gte("entry_date", weekStart)
      .not("ended_at", "is", null),
    supabase
      .from("project_members")
      .select("projects(id, name, status, customers(name))")
      .eq("user_id", userId)
      .limit(50),
  ])

  type SessionRaw = {
    id: string
    project_id: string
    started_at: string
    projects:
      | { name: string; customers: { name: string } | { name: string }[] | null }
      | { name: string; customers: { name: string } | { name: string }[] | null }[]
      | null
  }
  const sessionRaw = ((sessionRes.data as SessionRaw[] | null) ?? [])[0]
  const sessionProject = sessionRaw ? unwrapRelation(sessionRaw.projects) : null

  const weekHours = [0, 0, 0, 0, 0, 0, 0]
  for (const row of weekRes.data ?? []) {
    if (!row.entry_date) continue
    weekHours[weekdayIndex(row.entry_date)] += Number(row.hours || 0)
  }

  type MemberRaw = { projects: ProjectRow | ProjectRow[] | null }
  const active = new Set<string>(ACTIVE_PROJECT_STATUSES)
  const projects = ((membersRes.data as MemberRaw[] | null) ?? [])
    .map((row) => unwrapRelation(row.projects))
    .filter((p): p is ProjectRow => Boolean(p) && active.has(p!.status))
    .map(toHomeProject)
    // Det som pågår først — det er der dagen er.
    .sort((a, b) => Number(b.status === "active") - Number(a.status === "active"))
    .slice(0, 3)

  return {
    session: sessionRaw
      ? {
          id: sessionRaw.id,
          projectId: sessionRaw.project_id,
          projectName: sessionProject?.name || "Ukjent prosjekt",
          customer: sessionProject ? (unwrapRelation(sessionProject.customers)?.name ?? null) : null,
          startedAt: sessionRaw.started_at,
        }
      : null,
    weekHours,
    projects,
  }
}

/**
 * Siste ferdiglastede hjem per bruker, så appens kalde starter maler med en
 * gang mens de ferske spørringene kjører — samme stale-while-revalidate som
 * dashbordet (pa_dash_*). Kun visning; RLS er fortsatt grensen.
 */
const SNAPSHOT_PREFIX = "pa_home_v1:"

export function readHomeSnapshot<T>(scope: string): T | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_PREFIX + scope)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeHomeSnapshot<T>(scope: string, data: T) {
  try {
    window.localStorage.setItem(SNAPSHOT_PREFIX + scope, JSON.stringify(data))
  } catch {
    // Full/blokkert storage — bufferen er bare best-effort.
  }
}
