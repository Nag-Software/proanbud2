// Outreach performance metrics for the seller dashboard.
//
// Answers the only question that matters when you're trying to drive traffic:
// "is the machine running, and is what it sends actually working?" — volume over
// time, delivery/open/click/bounce rates, the live lead-pool gauge, and how many
// prospects have converted into real companies.

import { createAdminClient } from "@/lib/supabase/admin"
import { countSendableProspects } from "@/lib/outreach/import"
import { OUTREACH_TEMPLATE_IDS } from "@/lib/outreach/send"

export type OutreachDailyPoint = {
  date: string // YYYY-MM-DD
  sent: number
  opened: number
  clicked: number
}

export type OutreachMetrics = {
  // Volume
  sentToday: number
  sent7d: number
  sent30d: number
  // Engagement over the last 30 days (of emails sent in that window)
  delivered30d: number
  opened30d: number
  clicked30d: number
  bounced30d: number
  complained30d: number
  openRate: number // 0–1, opened / sent
  clickRate: number // 0–1, clicked / sent
  bounceRate: number // 0–1, bounced / sent
  // Lead pool ("fuel gauge")
  sendableNow: number // fresh prospects we can email right now
  prospectsTotal: number
  prospectsContacted: number
  prospectsNoEmail: number
  unsubscribed: number
  // Outcome
  conversions: number // prospects that became a registered company
  // Engine heartbeat
  lastCronRunAt: string | null
  nextCronAt: string | null
  // 14-day daily series for the chart
  daily: OutreachDailyPoint[]
}

/** Next time the outreach cron fires, derived from the vercel.json schedule
 *  "0 8 * * 1-5" (08:00 UTC, Mon–Fri). Kept in sync with vercel.json by hand. */
function computeNextCronAt(): string {
  const next = new Date()
  next.setUTCHours(8, 0, 0, 0)
  if (next.getTime() <= Date.now()) next.setUTCDate(next.getUTCDate() + 1)
  // Skip to Monday if it lands on Sat (6) or Sun (0).
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
    next.setUTCDate(next.getUTCDate() + 1)
  }
  return next.toISOString()
}

const DAY_MS = 24 * 60 * 60 * 1000

function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

export async function fetchOutreachMetrics(): Promise<OutreachMetrics> {
  const admin = createAdminClient()
  const templateIds = OUTREACH_TEMPLATE_IDS as unknown as string[]

  const now = Date.now()
  const startOfToday = new Date()
  startOfToday.setUTCHours(0, 0, 0, 0)
  const since30 = new Date(now - 30 * DAY_MS).toISOString()
  const since7 = new Date(now - 7 * DAY_MS).toISOString()
  const since14 = new Date(now - 14 * DAY_MS).toISOString()

  const [
    emailRows,
    sendableNow,
    prospectsTotal,
    prospectsContacted,
    prospectsNoEmail,
    unsubscribed,
    conversions,
    lastCron,
  ] = await Promise.all([
    admin
      .from("seller_email_log")
      .select("created_at, delivered_at, opened_at, clicked_at, bounced_at, complained_at")
      .in("template_id", templateIds)
      .gte("created_at", since30)
      .order("created_at", { ascending: true }),
    countSendableProspects(admin),
    admin.from("prospects").select("id", { count: "exact", head: true }),
    admin
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .eq("status", "kontaktet"),
    admin
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .is("email", null),
    admin.from("outreach_unsubscribes").select("id", { count: "exact", head: true }),
    admin
      .from("prospects")
      .select("id", { count: "exact", head: true })
      .not("matched_company_id", "is", null),
    admin
      .from("seller_activity_log")
      .select("created_at")
      .eq("action", "cron_outreach")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const rows = emailRows.data ?? []

  let sentToday = 0
  let sent7d = 0
  let delivered30d = 0
  let opened30d = 0
  let clicked30d = 0
  let bounced30d = 0
  let complained30d = 0

  // Pre-seed the 14-day series so empty days still render.
  const series = new Map<string, OutreachDailyPoint>()
  for (let i = 13; i >= 0; i--) {
    const key = dayKey(new Date(now - i * DAY_MS).toISOString())
    series.set(key, { date: key, sent: 0, opened: 0, clicked: 0 })
  }

  for (const row of rows) {
    if (row.created_at >= startOfToday.toISOString()) sentToday += 1
    if (row.created_at >= since7) sent7d += 1
    if (row.delivered_at) delivered30d += 1
    if (row.opened_at) opened30d += 1
    if (row.clicked_at) clicked30d += 1
    if (row.bounced_at) bounced30d += 1
    if (row.complained_at) complained30d += 1

    if (row.created_at >= since14) {
      const point = series.get(dayKey(row.created_at))
      if (point) {
        point.sent += 1
        if (row.opened_at) point.opened += 1
        if (row.clicked_at) point.clicked += 1
      }
    }
  }

  const sent30d = rows.length
  const safeRate = (n: number) => (sent30d > 0 ? n / sent30d : 0)

  return {
    sentToday,
    sent7d,
    sent30d,
    delivered30d,
    opened30d,
    clicked30d,
    bounced30d,
    complained30d,
    openRate: safeRate(opened30d),
    clickRate: safeRate(clicked30d),
    bounceRate: safeRate(bounced30d),
    sendableNow,
    prospectsTotal: prospectsTotal.count ?? 0,
    prospectsContacted: prospectsContacted.count ?? 0,
    prospectsNoEmail: prospectsNoEmail.count ?? 0,
    unsubscribed: unsubscribed.count ?? 0,
    conversions: conversions.count ?? 0,
    lastCronRunAt: (lastCron.data?.created_at as string | null) ?? null,
    nextCronAt: computeNextCronAt(),
    daily: [...series.values()],
  }
}
