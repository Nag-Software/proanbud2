import { fetchCompanyCalendarEvents } from "@/lib/platform/company-content"

import { CompanyCalendarClient } from "./kalender-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaKalenderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const events = await fetchCompanyCalendarEvents(id)
  return <CompanyCalendarClient events={events} />
}
