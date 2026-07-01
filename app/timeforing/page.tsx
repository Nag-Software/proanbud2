import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"

import { getMyTimeTrackingOverviewAction } from "./actions"
import { TimeforingClient } from "./timeforing-client"

// Arbeiderens viktigste daglige flate: stemple inn/ut uten å gå via et
// prosjekt. Eksplisitt rolleliste er viktig — uten den redirectes workers.
export default async function Page() {
  const { canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])
  const initial = await getMyTimeTrackingOverviewAction()

  return (
    <AppPageShell segments={["Timeføring"]}>
      <TimeforingClient role={canonicalRole} initial={initial} />
    </AppPageShell>
  )
}
