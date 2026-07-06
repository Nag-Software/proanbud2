import { fetchCompanyTimeEntries } from "@/lib/platform/company-content"

import { CompanyTimeEntriesClient } from "./timer-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaTimerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const entries = await fetchCompanyTimeEntries(id)
  return <CompanyTimeEntriesClient entries={entries} />
}
