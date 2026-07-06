import { fetchCompanyOffers } from "@/lib/platform/company-content"

import { CompanyOffersClient } from "./tilbud-client"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaTilbudPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const offers = await fetchCompanyOffers(id)
  return <CompanyOffersClient offers={offers} />
}
