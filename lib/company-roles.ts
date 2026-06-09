import type { SupabaseClient } from "@supabase/supabase-js"

import {
  DEFAULT_COMPANY_ROLE_NAMES,
  ROLE_DB_VALUES,
  type CanonicalRole,
  normalizeRole,
  roleNameToDisplay,
} from "@/lib/roles"

type RoleRow = {
  id: string
  name: string
}

export async function ensureCompanyRoles(
  supabase: SupabaseClient,
  companyId: string
): Promise<RoleRow[]> {
  const { data: existingRoles, error: existingError } = await supabase
    .from("roles")
    .select("id, name")
    .eq("company_id", companyId)

  if (existingError) {
    throw new Error(`Kunne ikke hente roller: ${existingError.message}`)
  }

  const existingNames = new Set((existingRoles || []).map((role) => role.name))
  const missingRoles = DEFAULT_COMPANY_ROLE_NAMES.filter((name) => !existingNames.has(name))

  if (missingRoles.length > 0) {
    const { error: insertError } = await supabase.from("roles").insert(
      missingRoles.map((name) => ({
        company_id: companyId,
        name,
      }))
    )

    if (insertError) {
      throw new Error(`Kunne ikke opprette standardroller: ${insertError.message}`)
    }
  }

  const { data: roles, error: reloadError } = await supabase
    .from("roles")
    .select("id, name")
    .eq("company_id", companyId)

  if (reloadError || !roles) {
    throw new Error("Kunne ikke laste roller etter opprettelse")
  }

  return roles
}

export async function assignUserRole(
  supabase: SupabaseClient,
  input: {
    userId: string
    companyId: string
    roleName: string
  }
) {
  const canonical = normalizeRole(input.roleName)
  if (!canonical) {
    throw new Error("Ugyldig rolle")
  }

  const roles = await ensureCompanyRoles(supabase, input.companyId)
  const displayName = roleNameToDisplay(canonical)
  const role = roles.find((entry) => entry.name === displayName)

  if (!role) {
    throw new Error("Rolle ikke funnet")
  }

  const { error: deleteError } = await supabase.from("user_roles").delete().eq("user_id", input.userId)
  if (deleteError) {
    throw new Error(`Klarte ikke fjerne eksisterende roller: ${deleteError.message}`)
  }

  const { error: insertError } = await supabase.from("user_roles").insert({
    user_id: input.userId,
    role_id: role.id,
  })

  if (insertError) {
    throw new Error(`Klarte ikke lagre rolle: ${insertError.message}`)
  }

  const { error: userUpdateError } = await supabase
    .from("users")
    .update({ role: ROLE_DB_VALUES[canonical] })
    .eq("id", input.userId)

  if (userUpdateError) {
    throw new Error(`Klarte ikke oppdatere brukerrolle: ${userUpdateError.message}`)
  }

  return { roleId: role.id, canonical }
}

export async function resolveRoleNamesForCompany(
  supabase: SupabaseClient,
  companyId: string,
  roleNames: string[]
): Promise<RoleRow[]> {
  const roles = await ensureCompanyRoles(supabase, companyId)
  const wanted = new Set(
    roleNames
      .map((name) => normalizeRole(name))
      .filter(Boolean)
      .map((canonical) => roleNameToDisplay(canonical as CanonicalRole))
  )

  return roles.filter((role) => wanted.has(role.name))
}
