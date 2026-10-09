"use server"

import { revalidatePath } from "next/cache"

import { getServerAuthContext } from "@/lib/auth/server-context"
import { logServerError } from "@/lib/errors/log"
import { isAdmin, isManagerOrAdmin } from "@/lib/roles"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * Koblingen ansatt ↔ timepris (db/115 employee_hourly_rates).
 *
 * Brukes fra både Mine priser → Timepriser («Koble ansatte») og Min bedrift →
 * Ansatte og roller («Timepris»-kolonnen), så det er én sannhet om hvem som
 * jobber til hvilken sats.
 *
 * Kostpris per ansatt er i praksis lønnsdata: bare leder/admin leser (RLS), og
 * bare admin endrer. Skrivingen går via service role fordi tabellen ikke har
 * noen skrivepolicy for vanlige brukere — admin- og samme-bedrift-sjekken
 * ligger derfor her.
 */

export type EmployeeRateAssignmentRow = {
  id: string
  name: string
  email: string
  isActive: boolean
  /** Timeprisen den ansatte er koblet til. `null` = regnes med snittet. */
  hourlyRateId: string | null
}

export type EmployeeRateAssignments = {
  /** false når db/115 ikke er kjørt — UI skjuler da koblingskontrollene. */
  available: boolean
  employees: EmployeeRateAssignmentRow[]
}

/** PostgREST svarer PGRST205 for en tabell den ikke kjenner; Postgres 42P01. */
function isMissingTable(error: { code?: string } | null | undefined) {
  return error?.code === "42P01" || error?.code === "PGRST205"
}

export async function getEmployeeRateAssignments(): Promise<EmployeeRateAssignments> {
  const context = await getServerAuthContext()
  if (!context?.companyId || !isManagerOrAdmin(context.role)) {
    return { available: false, employees: [] }
  }

  const [usersResult, assignmentsResult] = await Promise.all([
    context.supabase
      .from("users")
      .select("id, full_name, email, is_active")
      .eq("company_id", context.companyId)
      .order("full_name", { ascending: true }),
    context.supabase
      .from("employee_hourly_rates")
      .select("user_id, hourly_rate_id")
      .eq("company_id", context.companyId),
  ])

  if (assignmentsResult.error) {
    if (isMissingTable(assignmentsResult.error)) return { available: false, employees: [] }
    await logServerError({
      message: "Kunne ikke hente ansattes timepriser",
      error: assignmentsResult.error,
      source: "server",
      route: "getEmployeeRateAssignments",
      companyId: context.companyId,
    })
    return { available: false, employees: [] }
  }

  const rateByUser = new Map(
    (assignmentsResult.data ?? []).map((row) => [String(row.user_id), String(row.hourly_rate_id)])
  )

  return {
    available: true,
    employees: ((usersResult.data ?? []) as Array<{
      id: string
      full_name: string | null
      email: string | null
      is_active: boolean | null
    }>).map((user) => ({
      id: user.id,
      name: user.full_name?.trim() || user.email || "Ukjent",
      email: user.email ?? "",
      isActive: user.is_active !== false,
      hourlyRateId: rateByUser.get(user.id) ?? null,
    })),
  }
}

export async function setEmployeeHourlyRate(input: {
  userId: string
  /** `null` fjerner koblingen — den ansatte regnes med snittet igjen. */
  hourlyRateId: string | null
}): Promise<{ success: true } | { error: string }> {
  const context = await getServerAuthContext()
  if (!context) return { error: "Ikke autorisert" }
  if (!context.companyId) return { error: "Du må tilhøre en bedrift for å gjøre dette" }
  if (!isAdmin(context.role)) return { error: "Kun administratorer kan koble ansatte til timepriser" }

  const admin = createAdminClient()

  // Begge må tilhøre kallerens bedrift. Den sammensatte fremmednøkkelen i db/115
  // stopper det samme, men da som en kryptisk databasefeil.
  const [{ data: targetUser }, rateResult] = await Promise.all([
    admin.from("users").select("id, company_id").eq("id", input.userId).maybeSingle(),
    input.hourlyRateId
      ? admin.from("hourly_rates").select("id, company_id").eq("id", input.hourlyRateId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  if (!targetUser || targetUser.company_id !== context.companyId) {
    return { error: "Fant ikke den ansatte" }
  }
  if (input.hourlyRateId && (!rateResult.data || rateResult.data.company_id !== context.companyId)) {
    return { error: "Fant ikke timeprisen" }
  }

  const { error } = input.hourlyRateId
    ? await admin.from("employee_hourly_rates").upsert(
        {
          user_id: input.userId,
          company_id: context.companyId,
          hourly_rate_id: input.hourlyRateId,
          updated_at: new Date().toISOString(),
          updated_by: context.user.id,
        },
        { onConflict: "user_id" }
      )
    : await admin
        .from("employee_hourly_rates")
        .delete()
        .eq("user_id", input.userId)
        .eq("company_id", context.companyId)

  if (error) {
    if (isMissingTable(error)) {
      return { error: "Databasen er ikke oppdatert ennå – kjør migrasjonene (db/115) først." }
    }
    await logServerError({
      message: "Kunne ikke lagre ansattens timepris",
      error,
      source: "server",
      route: "setEmployeeHourlyRate",
      companyId: context.companyId,
      context: { userId: input.userId, hourlyRateId: input.hourlyRateId },
    })
    return { error: "Kunne ikke lagre koblingen. Prøv igjen." }
  }

  revalidatePath("/mine-priser/timepriser")
  revalidatePath("/min-bedrift/ansatte-og-roller")
  // Lønnsomheten på prosjektene regner med den nye satsen fra nå.
  revalidatePath("/prosjekter", "layout")
  return { success: true }
}
