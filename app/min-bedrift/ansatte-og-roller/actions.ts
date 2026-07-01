"use server"

import crypto from "crypto"
import { headers } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { revalidatePath } from "next/cache"
import { assignUserRole } from "@/lib/company-roles"
import { canInviteEmployees } from "@/lib/roles"
import { sendInvitationEmail } from "@/lib/invitations/email"

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
 * Felles sjekk for admin-handlinger: innlogget bruker må kunne administrere
 * ansatte, og vi trenger bedriften vedkommende tilhører.
 */
async function requireAdminWithCompany() {
  const supabase = await createClient()

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return { error: "Ikke autorisert" as const }
  }

  const effectiveRole = await getEffectiveRole(supabase, user.id)
  if (!canInviteEmployees(effectiveRole)) {
    return { error: "Kun administratorer kan gjøre dette" as const }
  }

  const { data: execUser } = await supabase
    .from("users")
    .select("company_id")
    .eq("id", user.id)
    .single()

  if (!execUser?.company_id) {
    return { error: "Du må tilhøre en bedrift for å gjøre dette" as const }
  }

  return { user, companyId: execUser.company_id as string }
}

async function resolveBaseUrl() {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (envUrl) return envUrl.replace(/\/$/, "")

  const headerList = await headers()
  const host = headerList.get("x-forwarded-host") || headerList.get("host")
  if (!host) return null
  const proto = headerList.get("x-forwarded-proto") || "https"
  return `${proto}://${host}`
}

export async function resendInvitation(invitationId: string) {
  const ctx = await requireAdminWithCompany()
  if ("error" in ctx) return { error: ctx.error }

  const admin = createAdminClient()

  const { data: invitation, error: inviteError } = await admin
    .from("invitations")
    .select("id, email, company_id, status")
    .eq("id", invitationId)
    .maybeSingle()

  if (inviteError || !invitation) {
    return { error: "Fant ikke invitasjonen" }
  }
  if (invitation.company_id !== ctx.companyId) {
    return { error: "Ikke autorisert til å endre denne invitasjonen" }
  }
  if (invitation.status !== "pending") {
    return { error: "Invitasjonen er ikke lenger aktiv" }
  }

  // Nytt token + ny frist, slik at lenken i den nye e-posten faktisk virker.
  const rawToken = crypto.randomBytes(32).toString("hex")
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex")
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  const { error: updateError } = await admin
    .from("invitations")
    .update({ token_hash: tokenHash, expires_at: expiresAt.toISOString() })
    .eq("id", invitationId)

  if (updateError) {
    return { error: "Kunne ikke fornye invitasjonen. Prøv igjen." }
  }

  const baseUrl = await resolveBaseUrl()
  if (!baseUrl) {
    return { error: "Kunne ikke lage invitasjonslenken. Prøv igjen." }
  }
  const invitationUrl = `${baseUrl}/signup?invite=${rawToken}`

  const emailSent = await sendInvitationEmail({
    email: invitation.email,
    invitationUrl,
    context: { companyId: ctx.companyId, userId: ctx.user.id, invitationId },
  })

  revalidatePath("/min-bedrift/ansatte-og-roller")
  return { success: true, emailSent, invitationUrl }
}

export async function revokeInvitation(invitationId: string) {
  const ctx = await requireAdminWithCompany()
  if ("error" in ctx) return { error: ctx.error }

  const admin = createAdminClient()

  const { data: invitation, error: inviteError } = await admin
    .from("invitations")
    .select("id, company_id, status")
    .eq("id", invitationId)
    .maybeSingle()

  if (inviteError || !invitation) {
    return { error: "Fant ikke invitasjonen" }
  }
  if (invitation.company_id !== ctx.companyId) {
    return { error: "Ikke autorisert til å endre denne invitasjonen" }
  }
  if (invitation.status !== "pending") {
    return { error: "Invitasjonen er allerede behandlet" }
  }

  const { error: updateError } = await admin
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", invitationId)
    .eq("status", "pending")

  if (updateError) {
    return { error: "Kunne ikke trekke tilbake invitasjonen. Prøv igjen." }
  }

  revalidatePath("/min-bedrift/ansatte-og-roller")
  return { success: true }
}

export async function setEmployeeActiveState(userId: string, active: boolean) {
  const ctx = await requireAdminWithCompany()
  if ("error" in ctx) return { error: ctx.error }

  if (userId === ctx.user.id) {
    return { error: "Du kan ikke deaktivere din egen konto." }
  }

  const admin = createAdminClient()

  const { data: targetUser, error: targetError } = await admin
    .from("users")
    .select("id, company_id")
    .eq("id", userId)
    .maybeSingle()

  if (targetError || !targetUser) {
    return { error: "Fant ikke den ansatte" }
  }
  if (targetUser.company_id !== ctx.companyId) {
    return { error: "Ikke autorisert til å endre denne brukeren" }
  }

  const { error: updateError } = await admin
    .from("users")
    .update({ is_active: active })
    .eq("id", userId)

  if (updateError) {
    return {
      error: active
        ? "Kunne ikke aktivere den ansatte. Prøv igjen."
        : "Kunne ikke deaktivere den ansatte. Prøv igjen.",
    }
  }

  revalidatePath("/min-bedrift/ansatte-og-roller")
  return { success: true }
}
