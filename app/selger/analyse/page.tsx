import { Suspense } from "react"

import { fetchSalesMetrics } from "@/lib/selger/email-metrics"
import { AnalyseClient } from "@/app/selger/analyse/analyse-client"

export const dynamic = "force-dynamic"

export default async function SelgerAnalysePage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string }>
}) {
  const { periode } = await searchParams
  const periodDays = [30, 90, 365].includes(Number(periode)) ? Number(periode) : 30
  const metrics = await fetchSalesMetrics(periodDays)

  // Suspense: AnalyseClient bruker useSearchParams for periodevelgeren.
  return (
    <Suspense fallback={null}>
      <AnalyseClient metrics={metrics} />
    </Suspense>
  )
}
