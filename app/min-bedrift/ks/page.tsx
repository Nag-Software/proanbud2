import { AppPageShell } from "@/components/app-page-shell"
import { PlanGate } from "@/components/billing/plan-gate"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasFeature, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"

import { KsTemplatesClient } from "./ks-templates-client"

export default async function KsTemplatesPage() {
  const { user } = await checkRoleAccess(["admin", "manager"])

  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!(await companyHasFeature(companyId, "ks"))) {
    return (
      <AppPageShell segments={["Min bedrift", "KS-maler"]}>
        <PlanGate
          featureName="KS"
          description="Lag og gjenbruk sjekkliste-maler for kvalitetssikring på prosjektene dine."
        />
      </AppPageShell>
    )
  }

  return (
    <AppPageShell segments={["Min bedrift", "KS-maler"]}>
      <KsTemplatesClient />
    </AppPageShell>
  )
}
