import { FirmaerClient } from "@/app/sjefen/firmaer/firmaer-client"
import { fetchSjefenCompanies } from "@/lib/sjefen/queries"

export const dynamic = "force-dynamic"

export default async function SjefenFirmaerPage() {
  const companies = await fetchSjefenCompanies()
  return <FirmaerClient companies={companies} />
}
