import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"

import { getKartDataAction, getKartWorkerProjectsAction } from "./actions"
import { KartClient } from "./kart-client"
import { KartWorkerClient } from "./kart-worker-client"

// Dynamic so the pin data is never served stale.
export const dynamic = "force-dynamic"

export default async function Page() {
  const { canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])

  // Workers get a read-only locator: their assigned projects as pins plus a
  // bottom-sheet card (navigate / open project). No live ops, no editing.
  if (canonicalRole === "worker") {
    const projects = await getKartWorkerProjectsAction()
    return (
      <AppPageShell segments={["Kart"]} noPadding>
        <KartWorkerClient initialProjects={projects} />
      </AppPageShell>
    )
  }

  // Admin + prosjektleder get the full live operations console.
  const { projects, customers, geofences, ops } = await getKartDataAction()
  return (
    <AppPageShell segments={["Kart"]} noPadding>
      <KartClient
        initialProjects={projects}
        initialCustomers={customers}
        initialGeofences={geofences}
        initialOps={ops}
      />
    </AppPageShell>
  )
}
