import { AppPageShell } from "@/components/app-page-shell"
import { ModuleGate } from "@/components/billing/module-gate"
import { getTripFormContextAction } from "@/app/kjorebok/actions"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasModule, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { MODULE_PRICING } from "@/lib/billing/plans"
import { createClient } from "@/lib/supabase/server"
import { TripCreate } from "./trip-create"

export default async function Page() {
  await checkRoleAccess(["admin", "manager"])

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const companyId = user ? await getCurrentCompanyIdForUser(user.id) : null
  const hasKjorebok = companyId ? await companyHasModule(companyId, "kjorebok") : false

  if (!hasKjorebok) {
    return (
      <AppPageShell segments={["Min bedrift", "Kjørebok", "Ny tur"]}>
        <ModuleGate
          moduleName="Kjørebok"
          monthlyPriceNok={MODULE_PRICING.kjorebok}
          description="Før kjørebok med GPS eller manuelt — statens satser, kart og overføring til Tripletex."
        />
      </AppPageShell>
    )
  }

  const context = await getTripFormContextAction()

  return (
    <AppPageShell segments={["Min bedrift", "Kjørebok", "Ny tur"]} noPadding>
      <TripCreate context={context} currentUserId={user!.id} />
    </AppPageShell>
  )
}
