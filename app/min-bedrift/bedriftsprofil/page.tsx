import { redirect } from "next/navigation"

import { AppPageShell } from "@/components/app-page-shell"
import { checkRoleAccess } from "@/lib/auth-utils"
import { fetchCompanyOfferDefaults, fetchCompanyProfileRow, mapCompanyRowToProfile } from "@/lib/tilbud/company-profile"
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

  const context = await getServerAuthContext()
  const user = context?.user ?? null

  if (!user) {
    redirect("/login")
  }

  // Firma-id-en er kjent fra konteksten, så profilen og tilbudsstandardene
  // hentes i samme runde (tidligere: users → companies → standarder, i serie).
  const companyId = context?.companyId ?? null
  const [companyResult, offerDefaults] = await Promise.all([
    fetchCompanyProfileRow(supabase, user.id, companyId),
    companyId ? fetchCompanyOfferDefaults(supabase, companyId) : Promise.resolve(null),
  ])

  if (!companyResult) {
    redirect("/create-company")
  }

  const initialProfile = mapCompanyRowToProfile({ ...companyResult.row, id: companyResult.companyId })
  const { available: offerDefaultsAvailable, ...initialOfferDefaults } =
    offerDefaults ?? (await fetchCompanyOfferDefaults(supabase, companyResult.companyId))

  return (
    <AppPageShell segments={["Min bedrift", "Bedriftsprofil"]}>
      <div className="w-full max-w-3xl">
        <BedriftsprofilClient
          initialProfile={initialProfile}
          profileFieldsAvailable={companyResult.profileFieldsAvailable}
          initialOfferDefaults={initialOfferDefaults}
          offerDefaultsAvailable={offerDefaultsAvailable}
        />
        {canonicalRole === "admin" ? (
          <DeleteCompanySection companyName={initialProfile.name} />
        ) : null}
      </div>
    </AppPageShell>
  )
}
