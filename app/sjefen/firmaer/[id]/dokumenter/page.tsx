import { fetchCompanyDocuments } from "@/lib/platform/company-content"

import { CompanyDocumentsClient } from "./dokumenter-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaDokumenterPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const documents = await fetchCompanyDocuments(id)
  return <CompanyDocumentsClient documents={documents} />
}
