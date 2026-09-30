"use server"

import { getCurrentUserRole } from "@/lib/auth-utils"
import { requireServerAuthContext } from "@/lib/auth/server-context"
import {
  buildDashboardProjectHealth,
  type DashboardProjectHealth,
  type MissingProjectHealth,
} from "@/lib/job-costing/project-health"
import { logServerError } from "@/lib/errors/log"
import { canManageProjects } from "@/lib/roles"

export type DashboardProjectHealthResult = {
  rows: DashboardProjectHealth[]
  totalActive: number
  missingCount: number
  firstMissingProjectId: string | null
}

export async function getDashboardProjectHealthAction(): Promise<DashboardProjectHealthResult> {
  const { canonicalRole } = await getCurrentUserRole()
  if (!canManageProjects(canonicalRole)) throw new Error("Mangler tilgang")

  // Samme kontekst som rollesjekken over nettopp løste opp — firmaet er med
  // der, så det trengs ikke et eget users-oppslag før prosjektene kan hentes.
  const { supabase, companyId } = await requireServerAuthContext()

  const projectsResult = await supabase
    .from("projects")
    .select("id, name, updated_at")
    .eq("company_id", companyId)
    .eq("status", "active")
    .order("updated_at", { ascending: false })

  if (projectsResult.error) {
    await logServerError({
      message: "Kunne ikke hente aktive prosjekter til timeforbruk på dashbordet",
      error: projectsResult.error,
      source: "action",
      route: "getDashboardProjectHealthAction",
    })
    throw new Error("Kunne ikke hente timeforbruk")
  }

  const projects = projectsResult.data ?? []
  if (projects.length === 0) {
    return {
      rows: [],
      totalActive: 0,
      missingCount: 0,
      firstMissingProjectId: null,
    }
  }

  const projectIds = projects.map((project) => project.id)
  const [offersResult, timeEntriesResult] = await Promise.all([
    supabase
      .from("offers")
      .select("project_id, line_items")
      .eq("company_id", companyId)
      .eq("status", "accepted")
      .in("project_id", projectIds),
    supabase
      .from("time_entries")
      .select("project_id, hours")
      .eq("company_id", companyId)
      .in("project_id", projectIds)
      .not("ended_at", "is", null)
      .not("hours", "is", null)
      .neq("status", "rejected"),
  ])

  const queryResults = [
    ["tilbud", offersResult],
    ["timer", timeEntriesResult],
  ] as const
  const failed = queryResults.find(([, result]) => result.error)
  if (failed) {
    await logServerError({
      message: `Kunne ikke hente ${failed[0]} til timeforbruk på dashbordet`,
      error: failed[1].error,
      source: "action",
      route: "getDashboardProjectHealthAction",
    })
    throw new Error("Kunne ikke hente timeforbruk")
  }

  const health = buildDashboardProjectHealth({
    projects,
    offers: offersResult.data ?? [],
    timeEntries: timeEntriesResult.data ?? [],
  })

  return {
    rows: health.rows.slice(0, 4),
    totalActive: projects.length,
    missingCount: health.missing.length,
    firstMissingProjectId: firstMissingProjectId(health.missing),
  }
}

function firstMissingProjectId(missing: MissingProjectHealth[]) {
  return missing[0]?.id ?? null
}
