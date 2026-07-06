import { fetchCompanyCustomers } from "@/lib/platform/company-content"

import { CompanyCustomersClient } from "./kunder-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaKunderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const customers = await fetchCompanyCustomers(id)
  return <CompanyCustomersClient customers={customers} />
}
