import { fetchCompanyTrips } from "@/lib/platform/company-content"

import { CompanyTripsClient } from "./kjorebok-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaKjorebokPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const trips = await fetchCompanyTrips(id)
  return <CompanyTripsClient trips={trips} />
}
