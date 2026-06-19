import Link from "next/link"

import { AppPageShell } from "@/components/app-page-shell"
import {
  getAccessibleProjectsAction,
  getDeviationStatsAction,
  getDeviationsAction,
} from "@/app/avvik/actions"
import { AvvikClient } from "@/app/avvik/avvik-client"
import { checkRoleAccess } from "@/lib/auth-utils"

export const dynamic = "force-dynamic"

export default async function AvvikPage() {
  // Company-wide deviation overview is part of HMS (managers/admins). Workers
  // report and follow up deviations from within their project's Avvik tab.
  await checkRoleAccess(["admin", "manager"])

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
