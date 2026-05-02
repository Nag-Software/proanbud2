"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"

export async function updateUserRole(userId: string, newRoleName: string) {
  const supabase = await createClient()

  // First, get the current user to verify access
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: "Ikke autorisert" }
  }

  // Find the company id for the user we are updating
  const { data: targetUser, error: targetError } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", userId)
    .single()

  if (targetError || !targetUser) {
    return { error: "Bruker ikke funnet" }
  }

  // Validate the executing user has access to this company
  const { data: execUser } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (!execUser || execUser.company_id !== targetUser.company_id) {
    return { error: "Ikke autorisert til å endre denne brukeren" }
  }

  // Get the role ID for the new role name
  const { data: newRole, error: roleError } = await supabase
    .from("roles")
    .select("id")
    .eq("company_id", targetUser.company_id)
    .eq("name", newRoleName)
    .single()

  if (roleError || !newRole) {
    return { error: "Rolle ikke funnet" }
  }

  // Delete all existing roles for this user
  const { error: deleteError } = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", userId)

  if (deleteError) {
    return { error: "Klarte ikke fjerne eksisterende roller" }
  }

  // Insert the new role
  const { error: insertError } = await supabase
    .from("user_roles")
    .insert({
      user_id: userId,
      role_id: newRole.id
    })

  if (insertError) {
    return { error: "Klarte ikke å lagre ny rolle" }
  }

  revalidatePath("/min-bedrift/ansatte-og-roller")
  return { success: true }
}
