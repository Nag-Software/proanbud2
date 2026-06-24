import { notFound } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { PlanGate } from "@/components/billing/plan-gate"
import { getProjectChecklistByIdAction } from "@/app/ks/actions"
import { companyHasFeature, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"

import { ChecklistFillClient } from "./checklist-fill-client"

export default async function ChecklistFillPage({
  params,
}: {
  params: Promise<{ id: string; checklistId: string }>
}) {
  const { id: projectId, checklistId } = await params
  const { user } = await checkRoleAccess(["admin", "manager"])

  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!companyId || !(await companyHasFeature(companyId, "ks"))) {
    return (
      <AppPageShell segments={["Prosjekter", "KS"]}>
        <PlanGate
          featureName="KS"
          description="Kvalitetssikring med sjekklister og maler er tilgjengelig i Proff-planen."
        />
      </AppPageShell>
    )
  }

  const supabase = await createClient()
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .eq("id", projectId)
    .maybeSingle()

  if (!project) notFound()

  let checklist
  try {
    checklist = await getProjectChecklistByIdAction(checklistId)
  } catch {
    notFound()
  }

  if (checklist.project_id !== projectId) notFound()

  return (
    <AppPageShell segments={["Prosjekter", project.name, "KS", checklist.name]}>
      <ChecklistFillClient
        projectId={projectId}
        projectName={project.name}
        initialChecklist={checklist}
      />
    </AppPageShell>
  )
}
