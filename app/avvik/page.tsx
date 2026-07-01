import Link from "next/link"

import { AppPageShell } from "@/components/app-page-shell"
import { PlanGate } from "@/components/billing/plan-gate"
import {
  getAccessibleProjectsAction,
  getDeviationStatsAction,
  getDeviationsAction,
} from "@/app/avvik/actions"
import { AvvikClient } from "@/app/avvik/avvik-client"
import { checkRoleAccess } from "@/lib/auth-utils"
import { companyHasFeature, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"

export const dynamic = "force-dynamic"

export default async function AvvikPage() {
  // Company-wide deviation overview is part of HMS (managers/admins). Workers
  // report and follow up deviations from within their project's Avvik tab.
  const { user } = await checkRoleAccess(["admin", "manager"])

  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!(await companyHasFeature(companyId, "avvik"))) {
    return (
      <AppPageShell segments={["Avvik"]}>
        <PlanGate
          featureName="Avvik"
          description="Registrer, følg opp og lukk avvik – RUH (rapport om uønsket hendelse), HMS og KS – for hele bedriften."
        />
      </AppPageShell>
    )
  }

  const [deviations, stats, projects] = await Promise.all([
    getDeviationsAction(),
    getDeviationStatsAction(),
    getAccessibleProjectsAction(),
  ])

  return (
    <AppPageShell segments={["Avvik"]}>
      <AvvikClient
        deviations={deviations}
        stats={stats}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </AppPageShell>
  )
}
