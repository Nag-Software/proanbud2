import { AnalyseClient } from "@/app/sjefen/analyse/analyse-client"
import { fetchSjefenAnalytics } from "@/lib/sjefen/analytics"

export const dynamic = "force-dynamic"

export default async function SjefenAnalysePage() {
  const initial = await fetchSjefenAnalytics()
  return <AnalyseClient initial={initial} />
}
