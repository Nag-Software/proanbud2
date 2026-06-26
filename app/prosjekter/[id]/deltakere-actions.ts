"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { canManageProjects } from "@/lib/roles"
import { logServerError } from "@/lib/errors/log"

// ==========================
// PARTICIPANTS Server Actions
// ==========================

/**
 * Only company admins/managers, or a project member with manager access, may
 * change a project's team. Also confirms the project belongs to the caller's company.
 */
async function assertCanManageParticipants(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string
) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error("Du må være logget inn")

  const { data: profile } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()
  if (!profile?.company_id) throw new Error("Fant ikke bedrift")

  const { data: project } = await supabase
    .from("projects")
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle()
  if (!project || project.company_id !== profile.company_id) {
    throw new Error("Ugyldig prosjekt")
  }

  if (canManageProjects(profile.role)) return { companyId: profile.company_id as string }

  const { data: membership } = await supabase
    .from("project_members")
    .select("access_level")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .maybeSingle()
  if (membership?.access_level === "manager") return { companyId: profile.company_id as string }

  throw new Error("Du har ikke tilgang til å endre deltakere i dette prosjektet")
}

export async function addProjectParticipantAction(projectId: string, userId: string, accessLevel: string) {
  const supabase = await createClient()
  const { companyId } = await assertCanManageParticipants(supabase, projectId)

  // The target user MUST belong to the caller's company — otherwise a manager could
  // inject an arbitrary (cross-tenant) user UUID into project_members, which would
  // grant that foreign user has_project_access → read of the project, its tasks,
  // offers and time entries. (The RLS policy only had USING, no WITH CHECK.)
  const { data: targetUser } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .eq("company_id", companyId)
    .maybeSingle()
  if (!targetUser) {
    throw new Error("Brukeren tilhører ikke bedriften din")
  }

  const { error } = await supabase.from("project_members").insert({
    project_id: projectId,
    user_id: userId,
    access_level: accessLevel
  })

  if (error) {
    console.error("Error adding participant:", error)
    if (error.code === '23505') { // Unique violation
        throw new Error("Brukeren er allerede deltaker i prosjektet")
    }
    await logServerError({
      message: "Kunne ikke legge til deltaker i prosjekt",
      error,
      source: "action",
      route: "addProjectParticipantAction",
      context: { projectId, userId, companyId },
    })
    throw new Error("Kunne ikke legge til deltaker")
  }

  revalidatePath(`/prosjekter/${projectId}`)
}

export async function removeProjectParticipantAction(projectId: string, userId: string) {
  const supabase = await createClient()
  await assertCanManageParticipants(supabase, projectId)

  const { error } = await supabase
    .from("project_members")
    .delete()
    .match({ project_id: projectId, user_id: userId })

  if (error) {
    console.error("Error removing participant:", error)
    await logServerError({
      message: "Kunne ikke fjerne deltaker fra prosjekt",
      error,
      source: "action",
      route: "removeProjectParticipantAction",
      context: { projectId, userId },
    })
    throw new Error("Kunne ikke fjerne deltaker")
  }

  revalidatePath(`/prosjekter/${projectId}`)
}

export async function getCompanyUsersAction() {
  const supabase = await createClient()
  
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error("Not authenticated")

  // Get user's company_id
  const { data: userData } = await supabase.from("users").select("company_id").eq("id", user.id).maybeSingle()
  if (!userData?.company_id) return []

  const { data, error } = await supabase
    .from("users")
    .select("id, full_name, email, role")
    .eq("company_id", userData.company_id)

  if (error) {
    console.error("Error fetching company users:", error)
    await logServerError({
      message: "Kunne ikke hente bedriftens brukere",
      error,
      source: "action",
      route: "getCompanyUsersAction",
      context: { companyId: userData.company_id, userId: user.id },
    })
    return []
  }

  return data
}
