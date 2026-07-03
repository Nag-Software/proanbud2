// Salgsmetrikk for /selger/analyse — erstatter motorens metrics.ts.
// Måler SALGET (pipeline, aktivitet, utfall), ikke maskinens helse.

import { createAdminClient } from "@/lib/supabase/admin"
import { PROSPECT_STATUSES, type ProspectStatus } from "@/lib/outreach/types"
import { OUTREACH_TEMPLATE_IDS } from "@/lib/outreach/send"

export type SalesMetrics = {
  periodDays: number
  pipelineCounts: Record<ProspectStatus, number>
  won: number
  lost: number
  lostReasons: Record<string, number>
  activity: {
    calls: number
    emails: number
    notes: number
    tasksDone: number
  }
  email: {
    sent: number
    opened: number
    clicked: number
    bounced: number
  }
}

const EMAIL_TEMPLATES = [...OUTREACH_TEMPLATE_IDS]

export async function fetchSalesMetrics(periodDays: number): Promise<SalesMetrics> {
  const admin = createAdminClient()
  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString()

  const emailBase = () =>
    admin
      .from("seller_email_log")
      .select("id", { count: "exact", head: true })
      .in("template_id", EMAIL_TEMPLATES)
      .gte("created_at", since)

  const activityCount = (action: string) =>
    admin
      .from("seller_activity_log")
      .select("id", { count: "exact", head: true })
      .eq("action", action)
      .gte("created_at", since)

  const [
    statusCounts,
    lostRows,
    wonRes,
    callsRes,
    emailsRes,
    notesRes,
    tasksRes,
    sentRes,
    openedRes,
    clickedRes,
    bouncedRes,
  ] = await Promise.all([
    Promise.all(
      PROSPECT_STATUSES.map(async (status) => {
        const { count } = await admin
          .from("prospects")
          .select("id", { count: "exact", head: true })
          .eq("status", status)
        return [status, count ?? 0] as const
      })
    ),
    admin
      .from("seller_activity_log")
      .select("metadata")
      .eq("action", "lost_prospect")
      .gte("created_at", since)
      .limit(500),
    activityCount("won_prospect"),
    activityCount("phone_call"),
    activityCount("send_email"),
    activityCount("note"),
    activityCount("task_done"),
    emailBase(),
    emailBase().not("opened_at", "is", null),
    emailBase().not("clicked_at", "is", null),
    emailBase().not("bounced_at", "is", null),
  ])

  const lostReasons: Record<string, number> = {}
  for (const row of lostRows.data ?? []) {
    const meta = (row.metadata as Record<string, unknown>) ?? {}
    const reason = typeof meta.lostReason === "string" ? meta.lostReason : "ukjent"
    lostReasons[reason] = (lostReasons[reason] ?? 0) + 1
  }

  return {
    periodDays,
    pipelineCounts: Object.fromEntries(statusCounts) as Record<ProspectStatus, number>,
    won: wonRes.count ?? 0,
    lost: (lostRows.data ?? []).length,
    lostReasons,
    activity: {
      calls: callsRes.count ?? 0,
      emails: emailsRes.count ?? 0,
      notes: notesRes.count ?? 0,
      tasksDone: tasksRes.count ?? 0,
    },
    email: {
      sent: sentRes.count ?? 0,
      opened: openedRes.count ?? 0,
      clicked: clickedRes.count ?? 0,
      bounced: bouncedRes.count ?? 0,
    },
  }
}
