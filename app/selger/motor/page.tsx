import { MotorClient } from "@/app/selger/motor/motor-client"
import { fetchOutreachMetrics } from "@/lib/outreach/metrics"
import { classifyEngineHealth } from "@/lib/selger/engine-health"
import { getOutreachDailyLimit } from "@/lib/outreach/send"
import { getPoolMinThreshold } from "@/lib/outreach/import"

export const dynamic = "force-dynamic"

export default async function SelgerMotorPage() {
  const metrics = await fetchOutreachMetrics()
  const health = classifyEngineHealth(metrics, {
    dailyLimit: getOutreachDailyLimit(),
    poolMin: getPoolMinThreshold(),
    lastCronRunAt: metrics.lastCronRunAt,
  })

  return <MotorClient metrics={metrics} health={health} dailyLimit={getOutreachDailyLimit()} />
}
