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
