import { fetchCompanyChecklists, fetchCompanyDeviations } from "@/lib/platform/company-content"

import { CompanyHmsClient } from "./hms-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaHmsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [deviations, checklists] = await Promise.all([
    fetchCompanyDeviations(id),
    fetchCompanyChecklists(id),
  ])
  return <CompanyHmsClient deviations={deviations} checklists={checklists} />
}
