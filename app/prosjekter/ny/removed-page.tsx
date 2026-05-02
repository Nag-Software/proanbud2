import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"
import { createClient } from "@/lib/supabase/server"
import { CreateProjectForm } from "./removed-create-project-form"

export default async function Page() {
  const { user } = await checkRoleAccess(["admin", "manager", "worker"])
  const supabase = await createClient()

  const [{ data: customers }, { data: users }] = await Promise.all([
    supabase.from("customers").select("id, name, city").order("name"),
    supabase.from("users").select("id, full_name, role").order("full_name"),
  ])

  return (
    <AppPageShell segments={["Prosjekter", "Nytt prosjekt"]}>
      <CreateProjectForm
        currentUserId={user.id}
        customers={customers || []}
        users={users || []}
      />
    </AppPageShell>
  )
}
