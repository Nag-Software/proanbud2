import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"
import { createClient } from "@/lib/supabase/server"

import { NewProjectWizard } from "./NewProjectWizard"

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>
}) {
  const params = await searchParams
  const { user } = await checkRoleAccess(["admin", "manager", "worker"])
  const supabase = await createClient()

  const [{ data: customers }, { data: users }] = await Promise.all([
    supabase.from("customers").select("id, name, city").order("name"),
    supabase.from("users").select("id, full_name, role").order("full_name"),
  ])

  const customerIdParam = Array.isArray(params.customerId) ? params.customerId[0] : params.customerId

  return (
    <AppPageShell segments={["Prosjekter", "Nytt prosjekt"]}>
      <NewProjectWizard
        currentUserId={user.id}
        customers={customers || []}
        employees={users || []}
        initialCustomerId={customerIdParam}
      />
    </AppPageShell>
  )
}
