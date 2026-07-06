import { fetchCompanyMessages } from "@/lib/platform/company-content"

import { CompanyMessagesClient } from "./meldinger-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaMeldingerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const messages = await fetchCompanyMessages(id)
  return <CompanyMessagesClient messages={messages} />
}
