import { fetchOutreachMetrics } from "@/lib/outreach/metrics"
import { OutreachAnalyseClient } from "@/app/selger/analyse/analyse-client"

export const dynamic = "force-dynamic"

export default async function SelgerAnalysePage() {
  const metrics = await fetchOutreachMetrics()
  return <OutreachAnalyseClient metrics={metrics} />
}
