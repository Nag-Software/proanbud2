"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getDeviationStatsAction, getDeviationsAction } from "@/app/avvik/actions"
import { assertPlanFeature } from "@/lib/billing/server-modules"
import { createClient } from "@/lib/supabase/server"
import { isAdmin } from "@/lib/roles"

const handbookSchema = z.object({
  handbookContent: z.string().max(50000),
})

async function getAuthContext(requireAdmin = false) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) throw new Error("Du må være innlogget")

  const { data: profile } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.company_id) throw new Error("Fant ikke bedrift")
  if (requireAdmin && !isAdmin(profile.role)) throw new Error("Kun administrator har tilgang")

  await assertPlanFeature(profile.company_id, "hms", "HMS")

  return { supabase, user, companyId: profile.company_id }
}

export async function getCompanyHmsAction() {
  const { supabase, companyId } = await getAuthContext()

  const { data } = await supabase
    .from("company_hms")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle()

  return (
    data || {
      company_id: companyId,
      handbook_content: "",
      updated_by: null,
      updated_at: new Date().toISOString(),
    }
  )
}

export async function updateCompanyHmsAction(input: { handbookContent: string }) {
  const parsed = handbookSchema.parse(input)
  const { supabase, user, companyId } = await getAuthContext(true)

  const { error } = await supabase.from("company_hms").upsert({
    company_id: companyId,
    handbook_content: parsed.handbookContent,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  })

  if (error) throw new Error("Kunne ikke lagre HMS-håndbok")

  revalidatePath("/hms")
}

export type HmsProjectHealth = {
  projectId: string
  projectName: string
  openDeviations: number
  checklistTotal: number
  checklistCompleted: number
  itemsTotal: number
  itemsAnswered: number
}

export type HmsDeviationBreakdown = {
  total: number
  open: number
  closed: number
  overdueOpen: number
  fromChecklist: number
  closedLast30Days: number
  avgClosureDays: number | null
  openByType: Record<string, number>
}

export type HmsChecklistStats = {
  total: number
  notStarted: number
  inProgress: number
  completed: number
  itemsTotal: number
  itemsAnswered: number
  itemsNotOk: number
  completionPercent: number
  fillPercent: number
}

export async function getHmsOverviewAction() {
  const { supabase, companyId } = await getAuthContext()
  const now = Date.now()
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [stats, openDeviations, handbook, deviationsResult, checklistsResult, projectsResult] =
    await Promise.all([
      getDeviationStatsAction(),
      getDeviationsAction({ status: "open" }),
      getCompanyHmsAction(),
      supabase
        .from("deviations")
        .select("id, status, type, source, created_at, closed_at, project_id")
        .eq("company_id", companyId),
      supabase
        .from("project_checklists")
        .select("id, status, project_id, items:project_checklist_items(response)")
        .eq("company_id", companyId),
      supabase
        .from("projects")
        .select("id, name, status")
        .eq("company_id", companyId)
        .in("status", ["planning", "active", "on_hold"]),
    ])

  const deviationRows = (deviationsResult.data || []) as Array<{
    id: string
    status: string
    type: string
    source: string | null
    created_at: string
    closed_at: string | null
    project_id: string
  }>

  const checklistRows = (checklistsResult.data || []) as Array<{
    id: string
    status: string
    project_id: string
    items: Array<{ response: string | null }> | null
  }>

  const activeProjects = (projectsResult.data || []) as Array<{
    id: string
    name: string
    status: string
  }>

  // ---- Deviation breakdown ----
  const openByType: Record<string, number> = {}
  let overdueOpen = 0
  let fromChecklist = 0
  let closedLast30Days = 0
  let closureDaysSum = 0
  let closureCount = 0

  for (const d of deviationRows) {
    if (d.source === "checklist") fromChecklist += 1
    if (d.status === "open") {
      openByType[d.type] = (openByType[d.type] || 0) + 1
      if (d.created_at < thirtyDaysAgo) overdueOpen += 1
    }
    if (d.status === "closed" && d.closed_at) {
      if (d.closed_at >= thirtyDaysAgo) closedLast30Days += 1
      const created = new Date(d.created_at).getTime()
      const closed = new Date(d.closed_at).getTime()
      if (Number.isFinite(created) && Number.isFinite(closed) && closed >= created) {
        closureDaysSum += (closed - created) / (24 * 60 * 60 * 1000)
        closureCount += 1
      }
    }
  }

  const deviationBreakdown: HmsDeviationBreakdown = {
    total: deviationRows.length,
    open: deviationRows.filter((d) => d.status === "open").length,
    closed: deviationRows.filter((d) => d.status === "closed").length,
    overdueOpen,
    fromChecklist,
    closedLast30Days,
    avgClosureDays: closureCount > 0 ? Math.round((closureDaysSum / closureCount) * 10) / 10 : null,
    openByType,
  }

  // ---- Checklist stats ----
  let itemsTotal = 0
  let itemsAnswered = 0
  let itemsNotOk = 0
  let notStarted = 0
  let inProgress = 0
  let completed = 0

  for (const cl of checklistRows) {
    if (cl.status === "completed") completed += 1
    else if (cl.status === "in_progress") inProgress += 1
    else notStarted += 1

    for (const item of cl.items || []) {
      itemsTotal += 1
      if (item.response !== null) itemsAnswered += 1
      if (item.response === "not_ok") itemsNotOk += 1
    }
  }

  const checklistStats: HmsChecklistStats = {
    total: checklistRows.length,
    notStarted,
    inProgress,
    completed,
    itemsTotal,
    itemsAnswered,
    itemsNotOk,
    completionPercent:
      checklistRows.length > 0 ? Math.round((completed / checklistRows.length) * 100) : 0,
    fillPercent: itemsTotal > 0 ? Math.round((itemsAnswered / itemsTotal) * 100) : 0,
  }

  // ---- Per-project HMS health ----
  const healthMap = new Map<string, HmsProjectHealth>()
  for (const project of activeProjects) {
    healthMap.set(project.id, {
      projectId: project.id,
      projectName: project.name,
      openDeviations: 0,
      checklistTotal: 0,
      checklistCompleted: 0,
      itemsTotal: 0,
      itemsAnswered: 0,
    })
  }

  for (const d of deviationRows) {
    if (d.status !== "open") continue
    const entry = healthMap.get(d.project_id)
    if (entry) entry.openDeviations += 1
  }

  for (const cl of checklistRows) {
    const entry = healthMap.get(cl.project_id)
    if (!entry) continue
    entry.checklistTotal += 1
    if (cl.status === "completed") entry.checklistCompleted += 1
    for (const item of cl.items || []) {
      entry.itemsTotal += 1
      if (item.response !== null) entry.itemsAnswered += 1
    }
  }

  const projectHealth = Array.from(healthMap.values())
    .sort((a, b) => {
      if (b.openDeviations !== a.openDeviations) return b.openDeviations - a.openDeviations
      const aFill = a.itemsTotal > 0 ? a.itemsAnswered / a.itemsTotal : 1
      const bFill = b.itemsTotal > 0 ? b.itemsAnswered / b.itemsTotal : 1
      return aFill - bFill
    })
    .slice(0, 8)

  return {
    stats,
    deviationBreakdown,
    checklistStats,
    projectHealth,
    openDeviations: openDeviations.slice(0, 6),
    handbook,
  }
}
