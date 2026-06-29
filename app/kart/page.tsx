import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"

import { getKartDataAction } from "./actions"
import { KartClient } from "./kart-client"

// Operations map — admin + prosjektleder only (workers are redirected by
// checkRoleAccess). Dynamic so the pin data is never served stale.
export const dynamic = "force-dynamic"

export default async function Page() {
  await checkRoleAccess(["admin", "manager"])
  const { projects, customers } = await getKartDataAction()

  return (
    <AppPageShell segments={["Kart"]} noPadding>
      <KartClient initialProjects={projects} initialCustomers={customers} />
    </AppPageShell>
  )
}
