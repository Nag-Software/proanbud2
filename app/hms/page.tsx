import { AppPageShell } from "@/components/app-page-shell"
import { PlanGate } from "@/components/billing/plan-gate"
import { HmsPageClient } from "@/app/hms/hms-page-client"
import { getHmsOverviewAction } from "@/app/hms/actions"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasFeature, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"

export const dynamic = "force-dynamic"

export default async function HmsPage() {
  const { user, canonicalRole } = await checkRoleAccess(["admin", "manager"])

  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!(await companyHasFeature(companyId, "hms"))) {
    return (
      <AppPageShell segments={["HMS"]}>
        <PlanGate
          featureName="HMS"
          description="Samle HMS-håndbok, avvik og sjekklister i én oversikt for bedriften."
        />
      </AppPageShell>
    )
  }

  const overview = await getHmsOverviewAction()

  return (
    <AppPageShell segments={["HMS"]}>
      <HmsPageClient
        isAdmin={canonicalRole === "admin"}
        stats={overview.stats}
        deviationBreakdown={overview.deviationBreakdown}
        checklistStats={overview.checklistStats}
        projectHealth={overview.projectHealth}
        openDeviations={overview.openDeviations}
        handbookContent={overview.handbook.handbook_content || ""}
      />
    </AppPageShell>
  )
}
