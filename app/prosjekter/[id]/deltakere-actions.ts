"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"

// ==========================
// PARTICIPANTS Server Actions
// ==========================

export async function addProjectParticipantAction(projectId: string, userId: string, accessLevel: string) {
  const supabase = await createClient()

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
    throw new Error("Kunne ikke legge til deltaker")
  }

  revalidatePath(`/prosjekter/${projectId}`)
}

export async function removeProjectParticipantAction(projectId: string, userId: string) {
  const supabase = await createClient()

  const { error } = await supabase
    .from("project_members")
    .delete()
    .match({ project_id: projectId, user_id: userId })

  if (error) {
    console.error("Error removing participant:", error)
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
    return []
  }

  return data
}
