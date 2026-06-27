import { SelgereClient } from "@/app/sjefen/selgere/selgere-client"
import { fetchAffiliatePartners } from "@/lib/affiliate/queries"

export const dynamic = "force-dynamic"

export default async function SjefenSelgerePage() {
  const partners = await fetchAffiliatePartners()
  return <SelgereClient partners={partners} />
}
