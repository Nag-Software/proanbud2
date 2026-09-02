import { redirect } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"
import { fetchCompanyProfileRow, mapCompanyRowToProfile } from "@/lib/tilbud/company-profile"
import { createClient } from "@/lib/supabase/server"
import { BedriftsprofilClient } from "./bedriftsprofil-client"
import { DeleteCompanySection } from "./delete-company-section"
import { getServerAuthContext } from "@/lib/auth/server-context"

export default async function Page() {
  const { canonicalRole } = await checkRoleAccess([
    "Administrator",
    "Prosjektleder",
    "admin",
    "manager",
  ])
  const supabase = await createClient()

  const user = (await getServerAuthContext())?.user ?? null

  if (!user) {
    redirect("/login")
  }

  const companyResult = await fetchCompanyProfileRow(supabase, user.id)

  if (!companyResult) {
    redirect("/create-company")
  }

  const initialProfile = mapCompanyRowToProfile({ ...companyResult.row, id: companyResult.companyId })

  return (
    <AppPageShell segments={["Min bedrift", "Bedriftsprofil"]}>
      <div className="w-full max-w-3xl">
        <BedriftsprofilClient
          initialProfile={initialProfile}
          profileFieldsAvailable={companyResult.profileFieldsAvailable}
        />
        {canonicalRole === "admin" ? (
          <DeleteCompanySection companyName={initialProfile.name} />
        ) : null}
      </div>
    </AppPageShell>
  )
}
