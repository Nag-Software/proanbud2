"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { canManageProjects } from "@/lib/roles"
import { sumHours } from "@/lib/time-tracking"
import { computeJobCosting, computeLaborCost } from "@/lib/job-costing/calc"

async function resolveCompanyProject(
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
    .select("id, company_id")
    .eq("id", projectId)
    .maybeSingle()
  if (!project || project.company_id !== profile.company_id) throw new Error("Ugyldig prosjekt")

  return { userId: user.id, companyId: profile.company_id as string, role: profile.role as string }
}

export type MaterialCost = {
  id: string
  supplier_name: string | null
  description: string | null
  amount_nok: number
  invoice_ref: string | null
  cost_date: string | null
  created_at: string
}

export type ProjectJobCosting = {
  revenueNok: number
  laborCostNok: number
  materialCostNok: number
  marginNok: number
  marginPct: number | null
  totalHours: number
  costRateNok: number
  acceptedOfferCount: number
  materialCosts: MaterialCost[]
}

export async function getProjectJobCostingAction(projectId: string): Promise<ProjectJobCosting> {
  const supabase = await createClient()
  const { companyId } = await resolveCompanyProject(supabase, projectId)

  const [{ data: offers }, { data: entries }, { data: materials }, { data: rates }] = await Promise.all([
    supabase
      .from("offers")
      .select("amount_nok")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .eq("status", "accepted"),
    supabase
      .from("time_entries")
      .select("hours")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .not("ended_at", "is", null),
    supabase
      .from("project_material_costs")
      .select("id, supplier_name, description, amount_nok, invoice_ref, cost_date, created_at")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("cost_date", { ascending: false, nullsFirst: false }),
    supabase.from("hourly_rates").select("cost_rate_nok").eq("company_id", companyId).not("cost_rate_nok", "is", null),
  ])

  const revenueNok = (offers ?? []).reduce((sum, o) => sum + Number(o.amount_nok || 0), 0)
  const totalHours = sumHours((entries ?? []) as Array<{ hours: number | null }>)
  // Fase 1: bruk snitt-kostpris av satte cost_rate_nok som lønnskost-rate (per-økt-sats kommer i Fase 4).
  const costRates = (rates ?? []).map((r) => Number(r.cost_rate_nok)).filter((n) => Number.isFinite(n) && n > 0)
  const costRateNok = costRates.length
    ? Math.round((costRates.reduce((a, b) => a + b, 0) / costRates.length) * 100) / 100
    : 0
  const laborCostNok = computeLaborCost(totalHours, costRateNok)
  const materialCostNok = (materials ?? []).reduce((sum, m) => sum + Number(m.amount_nok || 0), 0)

  const costing = computeJobCosting({ revenueNok, laborCostNok, materialCostNok })
  return {
    ...costing,
    totalHours: Math.round(totalHours * 100) / 100,
    costRateNok,
    acceptedOfferCount: (offers ?? []).length,
    materialCosts: (materials ?? []) as MaterialCost[],
  }
}

export async function addMaterialCostAction(input: {
  projectId: string
  supplierName?: string
  description?: string
  amountNok: number
  invoiceRef?: string
  costDate?: string
}) {
  const supabase = await createClient()
  const { userId, companyId, role } = await resolveCompanyProject(supabase, input.projectId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const amount = Number(input.amountNok)
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Ugyldig beløp")

  const { error } = await supabase.from("project_material_costs").insert({
    company_id: companyId,
    project_id: input.projectId,
    supplier_name: input.supplierName?.trim() || null,
    description: input.description?.trim() || null,
    amount_nok: amount,
    invoice_ref: input.invoiceRef?.trim() || null,
    cost_date: input.costDate || null,
    created_by: userId,
  })
  if (error) throw new Error(error.message)
  revalidatePath(`/prosjekter/${input.projectId}`)
}

export async function deleteMaterialCostAction(input: { projectId: string; id: string }) {
  const supabase = await createClient()
  const { companyId, role } = await resolveCompanyProject(supabase, input.projectId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const { error } = await supabase
    .from("project_material_costs")
    .delete()
    .eq("id", input.id)
    .eq("company_id", companyId)
    .eq("project_id", input.projectId)
  if (error) throw new Error(error.message)
  revalidatePath(`/prosjekter/${input.projectId}`)
}
