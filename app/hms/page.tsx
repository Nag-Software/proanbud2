import { AppPageShell } from "@/components/app-page-shell"
import { HmsPageClient } from "@/app/hms/hms-page-client"
import { getHmsOverviewAction } from "@/app/hms/actions"
import { checkRoleAccess } from "@/lib/auth-utils"

export const dynamic = "force-dynamic"

export default async function HmsPage() {
  const { canonicalRole } = await checkRoleAccess(["admin", "manager", "worker"])
  const overview = await getHmsOverviewAction()

  return (
    <AppPageShell segments={["HMS"]}>
      <HmsPageClient
        isAdmin={canonicalRole === "admin"}
        stats={overview.stats}
        openDeviations={overview.openDeviations}
        handbookContent={overview.handbook.handbook_content || ""}
      />
    </AppPageShell>
  )
}
