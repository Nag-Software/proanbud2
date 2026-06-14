import { notFound } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { DeviationDetailClient } from "@/app/avvik/[id]/deviation-detail-client"
import { getDeviationByIdAction } from "@/app/avvik/actions"
import { checkRoleAccess } from "@/lib/auth-utils"
import { canManageProjects } from "@/lib/roles"
import { createClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export default async function DeviationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { user, canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])

  let deviation
  try {
    deviation = await getDeviationByIdAction(id)
  } catch {
    notFound()
  }

  const supabase = await createClient()
  let canManage = canManageProjects(canonicalRole)

  if (!canManage) {
    const { data: membership } = await supabase
      .from("project_members")
      .select("access_level")
      .eq("project_id", deviation.project_id)
      .eq("user_id", user.id)
      .maybeSingle()
    canManage = membership?.access_level === "manager"
  }

  return (
    <AppPageShell segments={["Avvik", deviation.reference_number]}>
      <DeviationDetailClient deviation={deviation} canManage={canManage} />
    </AppPageShell>
  )
}
