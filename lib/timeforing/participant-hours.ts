import type { createClient } from "@/lib/supabase/server"
import { logServerError } from "@/lib/errors/log"
import { buildEmployeeSummaries, type TimeEntryRow } from "@/lib/time-tracking"

type ServerClient = Awaited<ReturnType<typeof createClient>>

/** Completed (ended + hours-logged) time entries, with user + project joins.
 *  Shared by the timeføring server actions and the project-detail page. */
export function completedEntriesQuery(supabase: ServerClient) {
  return supabase
    .from("time_entries")
    .select(
      "id, project_id, user_id, entry_date, hours, description, started_at, ended_at, created_at, users(full_name, email), projects(name)"
    )
    .not("ended_at", "is", null)
    .not("hours", "is", null)
}

/** Per-participant hour summaries for a single project. The caller is
 *  responsible for verifying the timeføring module + project-admin access
 *  (the exported server action does this; the project page already has it). */
export async function fetchParticipantHours(supabase: ServerClient, projectId: string) {
  const { data, error } = await completedEntriesQuery(supabase)
    .eq("project_id", projectId)
    .order("ended_at", { ascending: false })

  if (error) {
    console.error("Error fetching participant hours:", error)
    await logServerError({
      message: "Kunne ikke hente deltakertimer for prosjekt",
      error,
      source: "server",
      route: "fetchParticipantHours",
      context: { projectId },
    })
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
