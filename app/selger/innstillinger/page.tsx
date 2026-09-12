import { createAdminClient } from "@/lib/supabase/admin"
import { loadSettings } from "@/lib/outreach/settings"
import { getSendMode, getOutreachFromEmail, getOutreachDailyLimit } from "@/lib/outreach/send"
import { checkHealth } from "@/lib/outreach/health"
import { verifiedFacts, FACTS } from "@/lib/outreach/facts"
import { InnstillingerClient } from "./innstillinger-client"

export const dynamic = "force-dynamic"

async function fetchUnsubscribes() {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from("outreach_unsubscribes")
      .select("email, domain, org_number, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
    return (data ?? []) as Array<{
      email: string | null
      domain: string | null
      org_number: string | null
      reason: string | null
      created_at: string
    }>
  } catch {
    return []
  }
}

export default async function SelgerInnstillingerPage() {
  const [settings, health, unsubscribes] = await Promise.all([
    loadSettings(),
    checkHealth({ dryRun: true }),
    fetchUnsubscribes(),
  ])

  return (
    <InnstillingerClient
      settings={settings}
      health={health}
      sendMode={getSendMode()}
      fromEmail={getOutreachFromEmail()}
      envDailyLimit={getOutreachDailyLimit()}
      unsubscribes={unsubscribes}
      facts={FACTS.map((fact) => ({
        id: fact.id,
        text: fact.text,
        verified: fact.verified,
        source: fact.source,
      }))}
      verifiedCount={verifiedFacts().length}
    />
  )
}
