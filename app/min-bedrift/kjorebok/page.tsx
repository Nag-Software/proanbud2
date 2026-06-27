import { AppPageShell } from "@/components/app-page-shell"
import { ModuleGate } from "@/components/billing/module-gate"
import { getCompanyTripsOverviewAction } from "@/app/kjorebok/actions"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasModule, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { MODULE_PRICING } from "@/lib/billing/plans"
import { createClient } from "@/lib/supabase/server"
import { KjorebokClient } from "./kjorebok-client"

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
      <AppPageShell segments={["Min bedrift", "Kjørebok"]}>
        <ModuleGate
          moduleName="Kjørebok"
          monthlyPriceNok={MODULE_PRICING.kjorebok}
          description="Før kjørebok med GPS eller manuelt — statens satser, kart og overføring til Tripletex."
        />
      </AppPageShell>
    )
  }

  const overview = await getCompanyTripsOverviewAction()

  return (
    <AppPageShell segments={["Min bedrift", "Kjørebok"]}>
      <div className="mx-auto w-full space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Kjørebok</h1>
        </div>

        <KjorebokClient initialOverview={overview} currentUserId={user!.id} />
      </div>
    </AppPageShell>
  )
}
