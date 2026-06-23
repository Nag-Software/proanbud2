import { TodayClient } from "@/app/selger/today-client"
import { fetchOutreachMetrics } from "@/lib/outreach/metrics"
import { fetchWorkQueue, countQueue } from "@/lib/selger/queue"
import { buildFallbackStandup } from "@/lib/selger/standup"
import { classifyEngineHealth } from "@/lib/selger/engine-health"
import { getOutreachDailyLimit } from "@/lib/outreach/send"
import { getPoolMinThreshold } from "@/lib/outreach/import"

export const dynamic = "force-dynamic"

export default async function SelgerTodayPage() {
  const [metrics, cards] = await Promise.all([fetchOutreachMetrics(), fetchWorkQueue("all")])
  const counts = countQueue(cards)
  // Render the instant deterministic standup; the client upgrades it to the AI
  // version via /api/selger/standup so the cockpit never blocks on an LLM call.
  const standup = buildFallbackStandup(metrics, counts)

  const health = classifyEngineHealth(metrics, {
    dailyLimit: getOutreachDailyLimit(),
    poolMin: getPoolMinThreshold(),
    lastCronRunAt: metrics.lastCronRunAt,
  })

  return (
    <TodayClient
      standup={standup}
      metrics={metrics}
      health={health}
      initialCards={cards}
      counts={counts}
    />
  )
}
