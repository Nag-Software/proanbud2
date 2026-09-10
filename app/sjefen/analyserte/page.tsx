import { AnalyserteClient } from "@/app/sjefen/analyserte/analyserte-client"
import { fetchAnalyseLeads } from "@/lib/analyse-leads/queries"

export const dynamic = "force-dynamic"

export default async function SjefenAnalysertePage() {
  const { leads, sync } = await fetchAnalyseLeads()
  return <AnalyserteClient leads={leads} sync={sync} />
}
