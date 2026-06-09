import { redirect } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"
import { fetchCompanyProfileRow, mapCompanyRowToProfile } from "@/lib/tilbud/company-profile"
import { createClient } from "@/lib/supabase/server"
import { BedriftsprofilClient } from "./bedriftsprofil-client"

export default async function Page() {
  await checkRoleAccess(["Administrator", "Prosjektleder", "admin", "manager"])
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  const companyResult = await fetchCompanyProfileRow(supabase, user.id)

  if (!companyResult) {
    redirect("/create-company")
  }

  const initialProfile = mapCompanyRowToProfile({ ...companyResult.row, id: companyResult.companyId })

  return (
    <AppPageShell segments={["Min Bedrift", "Bedriftsprofil"]}>
      <div className="mx-auto w-full max-w-3xl">
        <BedriftsprofilClient
          initialProfile={initialProfile}
          profileFieldsAvailable={companyResult.profileFieldsAvailable}
        />
      </div>
    </AppPageShell>
  )
}
