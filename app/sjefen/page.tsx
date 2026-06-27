import { OverviewClient } from "@/app/sjefen/overview-client"
import { fetchSjefenAnalytics } from "@/lib/sjefen/analytics"
import { fetchSjefenOverview } from "@/lib/sjefen/queries"

export const dynamic = "force-dynamic"

export default async function SjefenOverviewPage() {
  const [stats, analytics] = await Promise.all([fetchSjefenOverview(), fetchSjefenAnalytics()])
  return <OverviewClient stats={stats} analytics={analytics} />
}
