import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"

import { KsTemplatesClient } from "./ks-templates-client"

export default async function KsTemplatesPage() {
  await checkRoleAccess(["admin", "manager"])

  return (
    <AppPageShell segments={["Min bedrift", "KS-maler"]}>
      <KsTemplatesClient />
    </AppPageShell>
  )
}
