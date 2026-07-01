import { Suspense } from "react"

import { AppPageShell } from "@/components/app-page-shell"
import { PlanGate } from "@/components/billing/plan-gate"
import { NewDeviationForm } from "@/app/avvik/ny/new-deviation-form"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasFeature, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"

export const dynamic = "force-dynamic"

export default async function NewAvvikPage() {
  const { user } = await checkRoleAccess(["admin", "manager", "worker"])

  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!(await companyHasFeature(companyId, "avvik"))) {
    return (
      <AppPageShell segments={["Avvik", "Meld avvik"]}>
        <PlanGate
          featureName="Avvik"
          description="Registrer, følg opp og lukk avvik – RUH (rapport om uønsket hendelse), HMS og KS – for hele bedriften."
        />
      </AppPageShell>
    )
  }

  return (
    <AppPageShell segments={["Avvik", "Meld avvik"]}>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Meld avvik</h1>
          <p className="text-sm text-muted-foreground">
            Registrer RUH (rapport om uønsket hendelse), HMS- eller KS-avvik med bilde og tekst
          </p>
        </div>
        <Suspense>
          <NewDeviationForm />
        </Suspense>
      </div>
    </AppPageShell>
  )
}
