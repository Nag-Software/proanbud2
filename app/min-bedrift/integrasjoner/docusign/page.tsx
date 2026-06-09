import { AppPageShell } from "@/components/app-page-shell"
import { createClient } from "@/lib/supabase/server"
import { checkRoleAccess } from "@/lib/auth-utils"

import { DocusignTesterClient } from "./docusign-tester-client"

export default async function DocusignPage() {
  await checkRoleAccess(["Administrator", "Prosjektleder", "admin", "manager"])
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let canManageIntegration = false
  let companyId = ""

  if (user) {
    const { data: userRow } = await supabase
      .from("users")
      .select("role, company_id")
      .eq("id", user.id)
      .maybeSingle()

    canManageIntegration = userRow?.role === "admin"
    companyId = userRow?.company_id || ""
  }

  return (
    <AppPageShell segments={["Min Bedrift", "Integrasjoner", "DocuSign"]}>
      <div className="flex flex-col gap-6 pb-8">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Integrasjoner</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">DocuSign</h1>
          <p className="text-sm text-muted-foreground">
            Styr konfigurasjonen for DocuSign integrasjonen din her.
          </p>
        </div>

        {!canManageIntegration ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Kun bedriftsadmin kan kjøre integrasjonstester og endre oppsett.
          </div>
        ) : null}

        {companyId && (
          <div className="mt-8">
             <h2 className="text-xl font-semibold tracking-tight text-foreground mb-4">Utviklertester</h2>
             <DocusignTesterClient />
          </div>
        )}
      </div>
    </AppPageShell>
  )
}
