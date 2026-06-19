import { createAdminClient } from "@/lib/supabase/admin"
import { locateCompany } from "@/lib/sjefen/norway-geo"

export type LiveLocation = {
  key: string
  name: string
  x: number
  y: number
  total: number
  active: number
}

export type LiveUser = {
  id: string
  name: string
  company: string
  location: string | null
  role: string | null
  lastSeenAt: string | null
}

export type SjefenAnalytics = {
  totalUsers: number
  activeNow: number
  active24h: number
  active7d: number
  totalCompanies: number
  activeSessions: number
  hoursToday: number
  hoursTotal: number
  locations: LiveLocation[]
  feed: LiveUser[]
  presenceEnabled: boolean
  generatedAt: string
}

const NOW_WINDOW_MS = 5 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

type UserRow = {
  id: string
  full_name: string | null
  role: string | null
  is_active: boolean | null
  last_seen_at?: string | null
  created_at: string | null
  company_id: string | null
  companies: { name: string | null; city: string | null; postal_code: string | null } | null
}

export async function fetchSjefenAnalytics(): Promise<SjefenAnalytics> {
  const admin = createAdminClient()
  const now = Date.now()

  // Pull users + their company's location in one shot. Retry without
  // last_seen_at if the presence migration (db/32) has not been run yet, so the
  // page renders instead of 500-ing.
  let presenceEnabled = true
  let rows: UserRow[] = []
  const withPresence = await admin
    .from("users")
    .select(
      "id, full_name, role, is_active, last_seen_at, created_at, company_id, companies(name, city, postal_code)"
    )
  if (withPresence.error) {
    presenceEnabled = false
    const fallback = await admin
      .from("users")
      .select("id, full_name, role, is_active, created_at, company_id, companies(name, city, postal_code)")
    rows = (fallback.data as unknown as UserRow[]) ?? []
  } else {
    rows = (withPresence.data as unknown as UserRow[]) ?? []
  }

  const locationMap = new Map<string, LiveLocation>()
  const feedCandidates: Array<LiveUser & { seenMs: number }> = []
  let activeNow = 0
  let active24h = 0
  let active7d = 0

  for (const row of rows) {
    const anchor = locateCompany(row.companies?.postal_code, row.companies?.city)
    if (anchor) {
      const existing =
        locationMap.get(anchor.key) ??
        { key: anchor.key, name: anchor.name, x: anchor.x, y: anchor.y, total: 0, active: 0 }
      existing.total += 1
      locationMap.set(anchor.key, existing)
    }

    const seenMs = row.last_seen_at ? new Date(row.last_seen_at).getTime() : 0
    if (seenMs) {
      const age = now - seenMs
      if (age <= NOW_WINDOW_MS) {
        activeNow += 1
        if (anchor) locationMap.get(anchor.key)!.active += 1
      }
      if (age <= DAY_MS) active24h += 1
      if (age <= 7 * DAY_MS) active7d += 1
    }

    feedCandidates.push({
      id: row.id,
      name: row.full_name ?? "Ukjent bruker",
      company: row.companies?.name ?? "Ukjent firma",
      location: anchor?.name ?? null,
      role: row.role,
      lastSeenAt: row.last_seen_at ?? null,
      seenMs,
    })
  }

  const feed: LiveUser[] = feedCandidates
    .sort((a, b) => b.seenMs - a.seenMs)
    .slice(0, 14)
    .map((c) => ({
      id: c.id,
      name: c.name,
      company: c.company,
      location: c.location,
      role: c.role,
      lastSeenAt: c.lastSeenAt,
    }))

  // Live work-session metrics from the time tracker (best-effort).
  let activeSessions = 0
  let hoursToday = 0
  let hoursTotal = 0
  let totalCompanies = 0
  try {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    const [sessionsRes, hoursRes, companiesRes] = await Promise.all([
      admin.from("time_entries").select("id", { count: "exact", head: true }).is("ended_at", null),
      admin.from("time_entries").select("hours, created_at").not("hours", "is", null).limit(10000),
      admin.from("companies").select("id", { count: "exact", head: true }),
    ])
    activeSessions = sessionsRes.count ?? 0
    totalCompanies = companiesRes.count ?? 0
    const startMs = startOfDay.getTime()
    for (const e of hoursRes.data ?? []) {
      const h = Number((e as { hours: number | null }).hours) || 0
      hoursTotal += h
      const created = (e as { created_at: string | null }).created_at
      if (created && new Date(created).getTime() >= startMs) hoursToday += h
    }
  } catch (error) {
    console.error("[sjefen/analytics] session stats failed", error)
  }

  return {
    totalUsers: rows.length,
    activeNow,
    active24h,
    active7d,
    totalCompanies,
    activeSessions,
    hoursToday: Math.round(hoursToday * 10) / 10,
    hoursTotal: Math.round(hoursTotal),
    locations: [...locationMap.values()].sort((a, b) => b.total - a.total),
    feed,
    presenceEnabled,
    generatedAt: new Date().toISOString(),
  }
}
