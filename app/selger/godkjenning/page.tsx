import { fetchApprovalQueue, fetchMachineFunnel } from "@/lib/selger/godkjenning"
import { loadSettings } from "@/lib/outreach/settings"
import { getSendMode } from "@/lib/outreach/send"
import { GodkjenningClient } from "./godkjenning-client"

export const dynamic = "force-dynamic"

export default async function SelgerGodkjenningPage() {
  const [queue, funnel, settings] = await Promise.all([
    fetchApprovalQueue({ limit: 50 }),
    fetchMachineFunnel(),
    loadSettings(),
  ])

  return (
    <GodkjenningClient
      initialQueue={queue}
      funnel={funnel}
      sendMode={getSendMode()}
      paused={settings.paused}
      pauseReason={settings.pause_reason}
    />
  )
}
