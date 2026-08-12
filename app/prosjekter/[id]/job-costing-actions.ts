"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { canManageProjects } from "@/lib/roles"
import { fetchProjectProfitability, readProjectBudget } from "@/lib/job-costing/project-profitability"
import type { ProjectProfitability } from "@/lib/job-costing/types"

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

  // `*` og ikke en kolonneliste med vilje: budsjettfeltene kom i db/76, og en
  // eksplisitt liste ville gjort hele fanen død med «column does not exist» i
  // en base der migrasjonen ennå ikke er kjørt. Med `*` mangler feltene bare,
  // og de leses defensivt.
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .maybeSingle()
  if (!project || project.company_id !== profile.company_id) throw new Error("Ugyldig prosjekt")

  return {
    userId: user.id,
    companyId: profile.company_id as string,
    role: profile.role as string,
    budget: readProjectBudget(project),
  }
}

export async function getProjectProfitabilityAction(
  projectId: string,
): Promise<ProjectProfitability> {
  const supabase = await createClient()
  const { companyId, role, budget } = await resolveCompanyProject(supabase, projectId)
  // Lønnsomhet er tall håndverkeren ikke skal se — samme grense som fanen har.
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  return fetchProjectProfitability(supabase, { companyId, projectId, ...budget })
}

/**
 * Lagrer målet jobben skal styres mot.
 *
 * Tomt felt lagres som NULL, ikke 0: «ikke satt» og «null timer budsjettert»
 * er to forskjellige ting, og bare den første skal skjule kalkylekolonnen.
 */
export async function saveProjectBudgetAction(input: {
  projectId: string
  budgetedHours: number | null
  budgetedMaterialNok: number | null
}) {
  const supabase = await createClient()
  const { companyId, role } = await resolveCompanyProject(supabase, input.projectId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const hours = normalizeOptionalNumber(input.budgetedHours, "Budsjetterte timer")
  const material = normalizeOptionalNumber(input.budgetedMaterialNok, "Budsjettert materialkost")
  const { error } = await supabase
    .from("projects")
    .update({
      budgeted_hours: hours,
      budgeted_material_nok: material,
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.projectId)
    .eq("company_id", companyId)

  if (error) throw new Error(error.message)
  revalidatePath(`/prosjekter/${input.projectId}`)
}

function normalizeOptionalNumber(value: number | null, label: string) {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} må være et positivt tall`)
  return parsed
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
