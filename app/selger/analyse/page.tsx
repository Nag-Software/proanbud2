import { Suspense } from "react"

import { fetchSalesMetrics } from "@/lib/selger/email-metrics"
import { fetchSalgsAnalyse } from "@/lib/selger/salgsanalyse"
import { fetchSegmentStats } from "@/lib/selger/segmenter"
import { computeAutonomy } from "@/lib/outreach/autonomy"
import { loadSettings, approvalModeFor } from "@/lib/outreach/settings"
import { SEGMENT_KEYS } from "@/lib/outreach/segments"
import { AnalyseClient } from "@/app/selger/analyse/analyse-client"
import { MaskinAnalyse } from "@/components/selger/maskin-analyse"

export const dynamic = "force-dynamic"

export default async function SelgerAnalysePage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>
}) {
  const { periode } = await searchParams
  const periodDays = [30, 90, 365].includes(Number(periode)) ? Number(periode) : 30
  const settings = await loadSettings()
  const [metrics, analyse, segments, autonomy] = await Promise.all([
    fetchSalesMetrics(periodDays),
    fetchSalgsAnalyse(),
    fetchSegmentStats(),
    Promise.all(
      SEGMENT_KEYS.map((key) => computeAutonomy(key, approvalModeFor(settings, key))),
    ),
  ])

  // Suspense: AnalyseClient bruker useSearchParams for periodevelgeren.
  return (
    <Suspense fallback={null}>
      <AnalyseClient metrics={metrics}>
        <MaskinAnalyse analyse={analyse} segments={segments} autonomy={autonomy} />
      </AnalyseClient>
    </Suspense>
  )
}
