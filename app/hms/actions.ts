"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { getDeviationStatsAction, getDeviationsAction } from "@/app/avvik/actions"
import { createClient } from "@/lib/supabase/server"
import { isAdmin } from "@/lib/roles"

const handbookSchema = z.object({
  handbookContent: z.string().max(50000),
})

async function getAuthContext(requireAdmin = false) {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) throw new Error("Du må være innlogget")

  const { data: profile } = await supabase
    .from("users")
    .select("company_id, role")
    .eq("id", user.id)
    .maybeSingle()

  if (!profile?.company_id) throw new Error("Fant ikke bedrift")
  if (requireAdmin && !isAdmin(profile.role)) throw new Error("Kun administrator har tilgang")

  return { supabase, user, companyId: profile.company_id }
}

export async function getCompanyHmsAction() {
  const { supabase, companyId } = await getAuthContext()

  const { data } = await supabase
    .from("company_hms")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle()

  return (
    data || {
      company_id: companyId,
      handbook_content: "",
      updated_by: null,
      updated_at: new Date().toISOString(),
    }
  )
}

export async function updateCompanyHmsAction(input: { handbookContent: string }) {
  const parsed = handbookSchema.parse(input)
  const { supabase, user, companyId } = await getAuthContext(true)

  const { error } = await supabase.from("company_hms").upsert({
    company_id: companyId,
    handbook_content: parsed.handbookContent,
    updated_by: user.id,
    updated_at: new Date().toISOString(),
  })

  if (error) throw new Error("Kunne ikke lagre HMS-håndbok")

  revalidatePath("/hms")
}

export async function getHmsOverviewAction() {
  const [stats, openDeviations, handbook] = await Promise.all([
    getDeviationStatsAction(),
    getDeviationsAction({ status: "open" }),
    getCompanyHmsAction(),
  ])

  return {
    stats,
    openDeviations: openDeviations.slice(0, 8),
    handbook,
  }
}
