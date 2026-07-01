import { AppPageShell } from "@/components/app-page-shell"
import { ModuleGate } from "@/components/billing/module-gate"
import { getTripFormContextAction } from "@/app/kjorebok/actions"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasModule, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { MODULE_PRICING } from "@/lib/billing/plans"
import { createClient } from "@/lib/supabase/server"
import { TripCreate } from "./trip-create"

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>
}) {
  // Workers may log their own trips (createTripAction enforces own-trips-only);
  // they reach this page from the project Kjørebok tab or their samlede
  // kjørebok på /kjorebok — so allow them here even though the company-wide
  // overview stays admin/manager only.
  const { canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])
  const isWorker = canonicalRole === "worker"

  const { project: projectId } = await searchParams
  // When launched from a project, return there (its Kjørebok tab) on save/cancel.
  // Otherwise workers go back to their own overview (/kjorebok) — the company
  // overview under Min bedrift would just bounce them to /prosjekter.
  const returnTo = projectId
    ? `/prosjekter/${projectId}?tab=kjorebok`
    : isWorker
      ? "/kjorebok"
      : undefined
  const segments = isWorker ? ["Kjørebok", "Ny tur"] : ["Min bedrift", "Kjørebok", "Ny tur"]

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const companyId = user ? await getCurrentCompanyIdForUser(user.id) : null
  const hasKjorebok = companyId ? await companyHasModule(companyId, "kjorebok") : false

  if (!hasKjorebok) {
    return (
      <AppPageShell segments={segments}>
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
    <AppPageShell segments={segments} noPadding>
      <TripCreate
        context={context}
        currentUserId={user!.id}
        defaultProjectId={projectId ?? null}
        returnTo={returnTo}
      />
    </AppPageShell>
  )
}
