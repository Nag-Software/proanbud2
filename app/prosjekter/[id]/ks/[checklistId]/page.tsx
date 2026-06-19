import { notFound } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { getProjectChecklistByIdAction } from "@/app/ks/actions"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"

import { ChecklistFillClient } from "./checklist-fill-client"

export default async function ChecklistFillPage({
  params,
}: {
  params: Promise<{ id: string; checklistId: string }>
}) {
  const { id: projectId, checklistId } = await params
  await checkRoleAccess(["admin", "manager"])

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
