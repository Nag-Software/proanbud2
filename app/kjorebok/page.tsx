import { redirect } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { ModuleGate } from "@/components/billing/module-gate"
import { getCompanyTripsOverviewAction } from "@/app/kjorebok/actions"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasModule, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { MODULE_PRICING } from "@/lib/billing/plans"
import { KjorebokWorkerClient } from "./kjorebok-worker-client"

// Samlet kjørebok for håndverkere: alle egne turer på tvers av prosjekter.
// Admin/prosjektleder har bedriftsoversikten under /min-bedrift/kjorebok og
// sendes dit — denne ruten er worker-varianten (jf. worker-kartet på /kart).
export default async function Page() {
  const { user, canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])
  if (canonicalRole !== "worker") redirect("/min-bedrift/kjorebok")

  const companyId = user ? await getCurrentCompanyIdForUser(user.id) : null
  const hasKjorebok = companyId ? await companyHasModule(companyId, "kjorebok") : false

  if (!hasKjorebok) {
    return (
      <AppPageShell segments={["Kjørebok"]}>
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
    <AppPageShell segments={["Kjørebok"]}>
      <div className="mx-auto w-full space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Kjørebok</h1>
          <p className="text-sm text-muted-foreground">
            Alle kjøreturene dine samlet — på tvers av prosjekter.
          </p>
        </div>

        <KjorebokWorkerClient initialOverview={overview} currentUserId={user!.id} />
      </div>
    </AppPageShell>
  )
}
