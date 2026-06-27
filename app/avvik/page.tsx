import Link from "next/link"

import { AppPageShell } from "@/components/app-page-shell"
import {
  getAccessibleProjectsAction,
  getDeviationsAction,
} from "@/app/avvik/actions"
import { AvvikClient } from "@/app/avvik/avvik-client"
import { checkRoleAccess } from "@/lib/auth-utils"

export const dynamic = "force-dynamic"

export default async function AvvikPage() {
  await checkRoleAccess(["admin", "manager", "worker"])

  const [deviations, projects] = await Promise.all([
    getDeviationsAction(),
    getAccessibleProjectsAction(),
  ])

  return (
    <AppPageShell segments={["Avvik"]}>
      <AvvikClient
        deviations={deviations}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </AppPageShell>
  )
}
