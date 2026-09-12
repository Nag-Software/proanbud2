// Helsevakt for leveringsdyktighet.
//
// Kald e-post går fra post@proanbud.no — det samme domenet som sender tilbud
// og varsler til betalende kunder. Et ødelagt domeneomdømme rammer dermed ikke
// salget først, det rammer produktet. Derfor er terskelen lav og reaksjonen
// hard: maskinen pauser seg selv, og Casper må skru den på igjen.
//
//   hard bounce over 3 % av de siste 50   → pause
//   én eneste spamklage                   → pause
//
// Én klage av femti er 2 %, og bransjetålegrensen er 0,1 %. Det er ikke en
// statistikk vi skal «se an».

import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"
import { OUTREACH_TEMPLATE_IDS } from "@/lib/outreach/send"
import { loadSettings, pauseMachine } from "@/lib/outreach/settings"
import {
  BOUNCE_THRESHOLD,
  COMPLAINT_THRESHOLD,
  evaluateHealth,
  HEALTH_WINDOW,
  MIN_SAMPLE,
} from "@/lib/outreach/health-rules"

export { BOUNCE_THRESHOLD, COMPLAINT_THRESHOLD, evaluateHealth, MIN_SAMPLE }


export type HealthReport = {
  sampled: number
  delivered: number
  bounced: number
  complained: number
  bounce_rate: number
  complaint_rate: number
  healthy: boolean
  /** Hvorfor vi pauset, eller null. */
  pause_reason: string | null
  /** Ble maskinen faktisk pauset av denne kjøringen? */
  paused_now: boolean
}

const EMPTY: HealthReport = {
  sampled: 0,
  delivered: 0,
  bounced: 0,
  complained: 0,
  bounce_rate: 0,
  complaint_rate: 0,
  healthy: true,
  pause_reason: null,
  paused_now: false,
}

type LogRow = {
  delivered_at: string | null
  bounced_at: string | null
  complained_at: string | null
}

/**
 * Leser de siste utsendingene og pauser maskinen hvis tallene er dårlige.
 *
 * `dryRun` gir rapporten uten å pause — brukes av Analyse-siden, som skal vise
 * helsen uten å endre den.
 */
export async function checkHealth(options: { dryRun?: boolean } = {}): Promise<HealthReport> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from("seller_email_log")
      .select("delivered_at, bounced_at, complained_at")
      .in("template_id", OUTREACH_TEMPLATE_IDS as unknown as string[])
      .order("created_at", { ascending: false })
      .limit(HEALTH_WINDOW)

    if (error || !data) return EMPTY

    const rows = data as LogRow[]
    const sampled = rows.length
    const delivered = rows.filter((row) => row.delivered_at).length
    const bounced = rows.filter((row) => row.bounced_at).length
    const complained = rows.filter((row) => row.complained_at).length

    const bounceRate = sampled > 0 ? bounced / sampled : 0
    const complaintRate = sampled > 0 ? complained / sampled : 0

    // Under terskelen for utvalgsstørrelse sier tallene ingenting — én bounce
    // av tre er 33 %, og det er ikke et signal.
    if (sampled < MIN_SAMPLE) {
      return {
        sampled,
        delivered,
        bounced,
        complained,
        bounce_rate: bounceRate,
        complaint_rate: complaintRate,
        healthy: true,
        pause_reason: null,
        paused_now: false,
      }
    }

    let reason: string | null = null
    if (complained >= COMPLAINT_THRESHOLD) {
      reason = `${complained} spamklage${complained > 1 ? "r" : ""} blant de siste ${sampled} sendingene`
    } else if (bounceRate > BOUNCE_THRESHOLD) {
      reason = `${Math.round(bounceRate * 100)} % harde returer blant de siste ${sampled} sendingene`
    }

    const report: HealthReport = {
      sampled,
      delivered,
      bounced,
      complained,
      bounce_rate: bounceRate,
      complaint_rate: complaintRate,
      healthy: reason === null,
      pause_reason: reason,
      paused_now: false,
    }

    if (reason && !options.dryRun) {
      const settings = await loadSettings()
      if (!settings.paused) {
        await pauseMachine(reason)
        report.paused_now = true
        void logServerError({
          message: "Salgsmaskinen pauset av helsevakten",
          level: "warning",
          source: "worker",
          context: { reason, bounced, complained, sampled },
        })
      }
    }

    return report
  } catch (error) {
    void logServerError({
      message: "Helsesjekk feilet",
      level: "warning",
      source: "worker",
      error,
    })
    return EMPTY
  }
}
