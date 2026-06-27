"use server"

import { createClient } from "@/lib/supabase/server"
import { revalidatePath } from "next/cache"
import { assignUserRole } from "@/lib/company-roles"
import { canInviteEmployees } from "@/lib/roles"

async function getEffectiveRole(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: userRoleData } = await supabase
    .from("user_roles")
    .select("roles(name)")
    .eq("user_id", userId)
    .maybeSingle()

  const { data: userTableData } = await supabase
    .from("users")
    .select("role")
    .eq("id", userId)
    .maybeSingle()

  // @ts-expect-error Supabase nested relation typing
  return userRoleData?.roles?.name || userTableData?.role || null
}

export async function updateUserRole(userId: string, newRoleName: string) {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: "Ikke autorisert" }
  }

  const effectiveRole = await getEffectiveRole(supabase, user.id)
  if (!canInviteEmployees(effectiveRole)) {
    return { error: "Kun administratorer kan endre roller" }
  }

  const { data: targetUser, error: targetError } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", userId)
    .single()

  if (targetError || !targetUser) {
    return { error: "Bruker ikke funnet" }
  }

  const { data: execUser } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (!execUser || execUser.company_id !== targetUser.company_id) {
    return { error: "Ikke autorisert til å endre denne brukeren" }
  }

  try {
    await assignUserRole(supabase, {
      userId,
      companyId: targetUser.company_id,
      roleName: newRoleName,
    })
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Klarte ikke å lagre ny rolle" }
  }

  revalidatePath("/min-bedrift/ansatte-og-roller")
  return { success: true }
}

/**
 * Felles RBAC + samme-bedrift-sjekk. Returnerer enten { error } eller { companyId }
 * for den innloggede admin-brukeren.
 */
async function requireAdminCompany(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: "Ikke autorisert" as const }
  }

  const effectiveRole = await getEffectiveRole(supabase, user.id)
  if (!canInviteEmployees(effectiveRole)) {
    return { error: "Kun administratorer kan utføre denne handlingen" as const }
  }

  const { data: execUser } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (!execUser?.company_id) {
    return { error: "Fant ikke bedriften din" as const }
  }

  return { userId: user.id, companyId: execUser.company_id as string }
}

export async function revokeInvitation(invitationId: string) {
  const supabase = await createClient()

  const ctx = await requireAdminCompany(supabase)
  if ("error" in ctx) return { error: ctx.error }

  const { data: invitation, error: invError } = await supabase
    .from("invitations")
    .select("company_id, status")
    .eq("id", invitationId)
    .single()

  if (invError || !invitation) {
    return { error: "Invitasjonen ble ikke funnet" }
  }

  if (invitation.company_id !== ctx.companyId) {
    return { error: "Ikke autorisert til å endre denne invitasjonen" }
  }

  const { error: updateError } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)

  if (updateError) {
    return { error: "Klarte ikke å trekke tilbake invitasjonen" }
  }

  revalidatePath("/min-bedrift/ansatte-og-roller")
  return { success: true }
}

export async function deactivateUser(userId: string) {
  const supabase = await createClient()

  const ctx = await requireAdminCompany(supabase)
  if ("error" in ctx) return { error: ctx.error }

  if (userId === ctx.userId) {
    return { error: "Du kan ikke deaktivere din egen bruker" }
  }

  const { data: targetUser, error: targetError } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", userId)
    .single()

  if (targetError || !targetUser) {
    return { error: "Bruker ikke funnet" }
  }

  if (targetUser.company_id !== ctx.companyId) {
    return { error: "Ikke autorisert til å endre denne brukeren" }
  }

  const { error: updateError } = await supabase
    .from("users")
    .update({ is_active: false })
    .eq("id", userId)

  if (updateError) {
    return { error: "Klarte ikke å deaktivere ansatt" }
  }

  revalidatePath("/min-bedrift/ansatte-og-roller")
  return { success: true }
}
