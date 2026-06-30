// Safety net: close time sessions a worker forgot to stop. Two triggers (both
// opt-in via company_tracking_settings): the company's shift end (Europe/Oslo),
// and a hard max-hours cap. Auto-closed entries are flagged + set to 'pending'
// so a manager checks the end time. Runs from the cron route via the admin
// client (no user session).

import { createAdminClient } from "@/lib/supabase/admin"
import { calculateSessionHours } from "@/lib/time-tracking"
import { logServerError } from "@/lib/errors/log"

type Settings = {
  company_id: string
  auto_close_enabled: boolean
  default_shift_end: string | null
  max_session_hours: number | null
}

export async function runAutoCloseStaleSessions(now: Date = new Date()) {
  const admin = createAdminClient()

  const { data: open, error } = await admin
    .from("time_entries")
    .select("id, company_id, started_at")
    .is("ended_at", null)

  if (error) {
    await logServerError({
      message: "Auto-lukking: kunne ikke hente åpne økter",
      error,
      source: "worker",
      route: "runAutoCloseStaleSessions",
    })
    return { scanned: 0, closed: 0 }
  }
  if (!open || open.length === 0) return { scanned: 0, closed: 0 }

  const companyIds = Array.from(new Set(open.map((o) => o.company_id as string)))
  const { data: settingsRows } = await admin
    .from("company_tracking_settings")
    .select("company_id, auto_close_enabled, default_shift_end, max_session_hours")
    .in("company_id", companyIds)
  const settings = new Map<string, Settings>(
    (settingsRows ?? []).map((s) => [s.company_id as string, s as Settings])
  )

  let closed = 0
  for (const session of open) {
    const cfg = settings.get(session.company_id as string)
    if (cfg && cfg.auto_close_enabled === false) continue

    const started = new Date(session.started_at as string)
    if (Number.isNaN(started.getTime())) continue

    const maxHours = cfg?.max_session_hours ?? 10
    let endAt: Date | null = null

    // Shift-end trigger (Oslo wall clock).
    if (cfg?.default_shift_end) {
      const shiftEnd = shiftEndInstant(started, cfg.default_shift_end)
      if (shiftEnd && now >= shiftEnd && started < shiftEnd) endAt = shiftEnd
    }
    // Max-hours hard cap.
    const maxEnd = new Date(started.getTime() + maxHours * 3_600_000)
    if (now >= maxEnd) {
      endAt = endAt ? new Date(Math.min(endAt.getTime(), maxEnd.getTime())) : maxEnd
    }

    if (!endAt) continue
    if (endAt <= started) endAt = new Date(started.getTime() + 60_000)

    const hours = calculateSessionHours(session.started_at as string, endAt)
    if (!(hours > 0)) continue

    const { error: updErr } = await admin
      .from("time_entries")
      .update({
        ended_at: endAt.toISOString(),
        hours,
        entry_date: endAt.toISOString().slice(0, 10),
        status: "pending",
        auto_closed: true,
        updated_at: now.toISOString(),
      })
      .eq("id", session.id)
      .is("ended_at", null) // guard against a race with a real stop
    if (!updErr) closed++
  }

  return { scanned: open.length, closed }
}

// UTC instant for a given "HH:MM" Oslo wall time on the calendar day the session
// started (in Oslo). DST-safe enough for a safety net.
function shiftEndInstant(started: Date, shiftEnd: string): Date | null {
  const [h, m] = shiftEnd.split(":").map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  const { year, month, day } = osloParts(started)
  const guess = Date.UTC(year, month - 1, day, h, m, 0)
  const offsetMin = osloOffsetMinutes(new Date(guess))
  return new Date(guess - offsetMin * 60_000)
}

function osloParts(at: Date): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const map = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]))
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) }
}

// Minutes to add to UTC to get Oslo wall time at the given instant.
function osloOffsetMinutes(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Oslo",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const map = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]))
  const asUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour === "24" ? "0" : map.hour),
    Number(map.minute),
    Number(map.second)
  )
  return (asUTC - at.getTime()) / 60_000
}
