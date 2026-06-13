import { OverviewClient } from "@/app/sjefen/overview-client"
import { fetchSjefenOverview } from "@/lib/sjefen/queries"

export const dynamic = "force-dynamic"

export default async function SjefenOverviewPage() {
  const stats = await fetchSjefenOverview()
  return <OverviewClient stats={stats} />
}
