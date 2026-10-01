"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { canManageProjects } from "@/lib/roles"
import { fetchProjectProfitability, readProjectBudget } from "@/lib/job-costing/project-profitability"
import type { ProjectProfitability } from "@/lib/job-costing/types"
import { getVerifiedUser } from "@/lib/auth/server-context"
import { logServerError } from "@/lib/errors/log"
import { linkBookedManualCosts } from "@/lib/regnskap/cost-store"
import { enqueueCostPull, enqueueMaterialCostSync } from "@/lib/regnskap/sync"

async function resolveCompanyProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
) {
  const {
    data: { user },
  } = await getVerifiedUser(supabase)
  if (!user) throw new Error("Du må være logget inn")

  // Profil og prosjekt slås opp i samme bølge: begge trenger bare id-er vi
  // allerede har, og sjekken under er den samme. Sparte én rundtur per action.
  // `*` og ikke en kolonneliste med vilje for prosjektet: budsjettfeltene kom
  // i db/76, og en eksplisitt liste ville gjort hele fanen død med «column does
  // not exist» i en base der migrasjonen ennå ikke er kjørt. Med `*` mangler
  // feltene bare, og de leses defensivt.
  const [{ data: profile }, { data: project }] = await Promise.all([
    supabase.from("users").select("company_id, role").eq("id", user.id).maybeSingle(),
    supabase.from("projects").select("*").eq("id", projectId).maybeSingle(),
  ])
  if (!profile?.company_id) throw new Error("Fant ikke bedrift")
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
 * «Hent nå»: les kostnadene ført på prosjektet i regnskapet nå, i stedet for å
 * vente på nattjobben. Kjører køen før vi svarer, så fanen viser nye tall når den
 * laster på nytt. Fiken kan være opptatt med en annen jobb (én forespørsel om
 * gangen) — da ligger jobben i køen, og `completed: false` lar UI-et si det ærlig
 * i stedet for å melde «hentet» for tidlig.
 */
export async function pullAccountingCostsAction(projectId: string) {
  const supabase = await createClient()
  const { companyId, role } = await resolveCompanyProject(supabase, projectId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const readPulledAt = async () => {
    const { data } = await supabase
      .from("project_accounting_cost_syncs")
      .select("pulled_at")
      .eq("company_id", companyId)
      .eq("project_id", projectId)
      .order("pulled_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data?.pulled_at as string | undefined) ?? null
  }

  const before = await readPulledAt()
  const provider = await enqueueCostPull({
    companyId,
    projectId,
    source: "manual",
    waitForCompletion: true,
  })
  if (!provider) {
    throw new Error("Henting av kostnader er ikke slått på for regnskapsintegrasjonen.")
  }
  const after = await readPulledAt()
  revalidatePath(`/prosjekter/${projectId}`)
  return { provider, completed: after !== null && after !== before }
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

  const { data: inserted, error } = await supabase.from("project_material_costs").insert({
    company_id: companyId,
    project_id: input.projectId,
    source: "manual",
    supplier_name: input.supplierName?.trim() || null,
    description: input.description?.trim() || null,
    amount_nok: amount,
    invoice_ref: input.invoiceRef?.trim() || null,
    cost_date: input.costDate || null,
    created_by: userId,
  }).select("id").single()
  if (error) throw new Error(error.message)

  // Er kjøpet allerede bokført i regnskapet, kobles posten med en gang, så den
  // ikke teller dobbelt i påvente av neste henting.
  let linked = false
  try {
    linked = (await linkBookedManualCosts({ companyId, projectId: input.projectId })) > 0
  } catch (linkError) {
    await logServerError({
      message: "Kunne ikke koble ny materialkost mot bokførte kostnader",
      error: linkError,
      source: "server",
      route: "addMaterialCostAction",
      context: { projectId: input.projectId },
    })
  }
  // Ikke bokført ennå: send den til regnskapet som kladd, så regnskapsføreren ser den.
  let sentTo: string | null = null
  if (!linked && inserted?.id) {
    sentTo = await syncMaterialCostSafely(companyId, String(inserted.id), "push", input.projectId)
  }
  revalidatePath(`/prosjekter/${input.projectId}`)
  return { linked, sentTo }
}

/** Kladd-synken skal aldri felle lagringen i ProAnbud — feil logges, ikke kastes. */
async function syncMaterialCostSafely(
  companyId: string,
  materialCostId: string,
  action: "push" | "delete",
  projectId: string
) {
  try {
    return await enqueueMaterialCostSync({ companyId, materialCostId, action })
  } catch (syncError) {
    await logServerError({
      message: action === "push" ? "Kunne ikke legge materialkost i kø mot regnskapet" : "Kunne ikke rydde kladd i regnskapet",
      error: syncError,
      source: "server",
      route: "job-costing-actions",
      context: { projectId, materialCostId },
    })
    return null
  }
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
    // Bokførte kostnader eies av regnskapet: de rettes der, ikke her.
    .eq("source", "manual")
  if (error) throw new Error(error.message)
  // Kladden vi sendte skal ikke bli liggende i regnskapet. Koblingen overlever raden.
  await syncMaterialCostSafely(companyId, input.id, "delete", input.projectId)
  revalidatePath(`/prosjekter/${input.projectId}`)
}

/**
 * «Ikke samme kjøp»: løsne en manuell post fra den bokførte kostnaden den ble
 * koblet til. Den teller igjen, og kobles aldri automatisk på nytt.
 */
export async function unlinkMaterialCostAction(input: { projectId: string; id: string }) {
  const supabase = await createClient()
  const { companyId, role } = await resolveCompanyProject(supabase, input.projectId)
  if (!canManageProjects(role)) throw new Error("Mangler tilgang")

  const { error } = await supabase
    .from("project_material_costs")
    .update({ replaced_by: null, keep_separate: true, updated_at: new Date().toISOString() })
    .eq("id", input.id)
    .eq("company_id", companyId)
    .eq("project_id", input.projectId)
    .eq("source", "manual")
  if (error) throw new Error(error.message)
  // Teller nå for seg selv — og er ikke bokført, så den går til regnskapet som kladd.
  await syncMaterialCostSafely(companyId, input.id, "push", input.projectId)
  revalidatePath(`/prosjekter/${input.projectId}`)
}
