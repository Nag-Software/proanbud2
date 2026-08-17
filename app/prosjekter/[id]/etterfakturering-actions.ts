"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { canManageProjects } from "@/lib/roles"
import {
  type ChangeOrder,
  type ChangeOrderBillingType,
} from "@/lib/tilleggsarbeid/change-order"

type ProjectContext = {
  id: string
  company_id: string
  customer_id: string | null
  customers?: { email: string | null; name: string | null } | { email: string | null; name: string | null }[] | null
}

async function resolveProjectCompany(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
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
    .select("id, company_id, customer_id, customers(email, name)")
    .eq("id", projectId)
    .maybeSingle()
  if (!project || project.company_id !== profile.company_id) throw new Error("Ugyldig prosjekt")

  return {
    userId: user.id,
    companyId: profile.company_id as string,
    role: profile.role as string,
    project: project as ProjectContext,
  }
}

function parsePositiveAmount(value: number, label: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} må være et positivt tall`)
  return Math.round(parsed * 100) / 100
}

export async function listProjectChangeOrdersAction(projectId: string): Promise<ChangeOrder[]> {
  const supabase = await createClient()
  const { companyId } = await resolveProjectCompany(supabase, projectId)
  const { data } = await supabase
    .from("change_orders")
    .select(
      "id, offer_id, project_id, title, description, amount_nok, billing_type, hourly_rate_nok, estimated_hours, status, public_slug, sent_at, customer_responded_at, created_at",
    )
    .eq("company_id", companyId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
  return (data ?? []) as ChangeOrder[]
}

export async function createProjectChangeOrderAction(input: {
  projectId: string
  billingType: ChangeOrderBillingType
  title: string
  description?: string
  fixedPriceNok?: number | null
  hourlyRateNok?: number | null
  estimatedHours?: number | null
}) {
  const supabase = await createClient()
  const { userId, companyId, role } = await resolveProjectCompany(supabase, input.projectId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const title = input.title?.trim()
  if (!title) throw new Error("Tittel mangler")

  const billingType = input.billingType === "hourly" ? "hourly" : "fixed"
  const description = input.description?.trim() || null

  let amountNok = 0
  let hourlyRateNok: number | null = null
  let estimatedHours: number | null = null

  if (billingType === "hourly") {
    hourlyRateNok = parsePositiveAmount(input.hourlyRateNok ?? 0, "Timepris")
    estimatedHours = parsePositiveAmount(input.estimatedHours ?? 0, "Estimert antall timer")
    amountNok = parsePositiveAmount(hourlyRateNok * estimatedHours, "Beløp")
  } else {
    amountNok = parsePositiveAmount(input.fixedPriceNok ?? 0, "Fastpris")
  }

  const { error } = await supabase.from("change_orders").insert({
    company_id: companyId,
    offer_id: null,
    project_id: input.projectId,
    customer_id: null,
    title,
    description,
    amount_nok: amountNok,
    billing_type: billingType,
    hourly_rate_nok: hourlyRateNok,
    estimated_hours: estimatedHours,
    // Interne etterfaktura går ikke ut til kunden for godkjenning (sending er
    // deaktivert), så de skal ikke ligge som «utkast». De er godkjent arbeid
    // med en gang — og «accepted» er dessuten statusen lønnsomhet teller som
    // omsetning.
    status: "accepted",
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidatePath(`/prosjekter/${input.projectId}`)
}

export async function deleteProjectChangeOrderAction(input: { projectId: string; id: string }) {
  const supabase = await createClient()
  const { companyId, role } = await resolveProjectCompany(supabase, input.projectId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const { error } = await supabase
    .from("change_orders")
    .delete()
    .eq("id", input.id)
    .eq("company_id", companyId)
    .eq("project_id", input.projectId)
  if (error) throw new Error(error.message)
  revalidatePath(`/prosjekter/${input.projectId}`)
}

export async function sendProjectChangeOrderAction(input: { projectId: string; id: string }) {
  throw new Error("Sending er deaktivert for etterfakturering")
}