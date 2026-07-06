import { fetchCompanyContracts } from "@/lib/platform/company-content"

import { CompanyContractsClient } from "./kontrakter-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaKontrakterPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const contracts = await fetchCompanyContracts(id)
  return <CompanyContractsClient contracts={contracts} />
}
