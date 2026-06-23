import { NextResponse } from "next/server"

import { requirePlatformSellerForApi } from "@/lib/auth/require-platform-seller-api"
import { fetchOutreachMetrics } from "@/lib/outreach/metrics"
import { countQueue, fetchWorkQueue } from "@/lib/selger/queue"
import { generateStandup } from "@/lib/selger/standup"

// Non-blocking AI standup for the cockpit. The page renders the deterministic
// fallback instantly; the client calls this to upgrade it to the LLM version.
export const maxDuration = 20

export async function GET() {
  const auth = await requirePlatformSellerForApi()
  if (auth.error) return auth.error

  const [metrics, cards] = await Promise.all([fetchOutreachMetrics(), fetchWorkQueue("all")])
  const standup = await generateStandup(metrics, countQueue(cards))
  return NextResponse.json({ standup })
}
