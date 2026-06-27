import "server-only"

import { createAdminClient } from "@/lib/supabase/admin"

export type ErrorLogRow = {
  id: string
  created_at: string
  level: "warning" | "error" | "fatal"
  source: "client" | "server" | "api" | "action" | "worker"
  message: string
  stack: string | null
  digest: string | null
  route: string | null
  method: string | null
  status_code: number | null
  company_id: string | null
  company_name: string | null
  user_id: string | null
  user_email: string | null
  user_agent: string | null
  context: Record<string, unknown>
  fingerprint: string
  resolved: boolean
  resolved_at: string | null
}

export type ErrorGroup = {
  fingerprint: string
  message: string
  level: ErrorLogRow["level"]
  source: ErrorLogRow["source"]
  count: number
  resolved: boolean
  firstSeen: string
  lastSeen: string
  routes: string[]
  affectedCompanies: number
  affectedUsers: number
  occurrences: ErrorLogRow[]
}

export type ErrorLogDashboard = {
  groups: ErrorGroup[]
  summary: {
    unresolvedGroups: number
    unresolvedOccurrences: number
    fatalUnresolved: number
    last24h: number
  }
}

const LEVEL_RANK: Record<ErrorLogRow["level"], number> = { fatal: 3, error: 2, warning: 1 }

/**
 * Loads recent error logs (last `days` days, capped) and groups them by fingerprint
 * for the /sjefen/feil dashboard. Uses the service-role admin client (the table is
 * RLS deny-all; only platform admins reach this via the sjefen layout guard).
 */
export async function fetchErrorLogDashboard(options?: {
  includeResolved?: boolean
  days?: number
  limit?: number
}): Promise<ErrorLogDashboard> {
  const admin = createAdminClient()
  const days = options?.days ?? 30
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  let query = admin
    .from("error_logs")
    .select(
      "id, created_at, level, source, message, stack, digest, route, method, status_code, company_id, user_id, user_email, user_agent, context, fingerprint, resolved, resolved_at, company:companies(name)"
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 2000)

  if (!options?.includeResolved) {
    query = query.eq("resolved", false)
  }

  const { data, error } = await query
  if (error) {
    console.error("[fetchErrorLogDashboard]", error.message)
    return { groups: [], summary: { unresolvedGroups: 0, unresolvedOccurrences: 0, fatalUnresolved: 0, last24h: 0 } }
  }

  const rows: ErrorLogRow[] = (data || []).map((r) => {
    const company = (r as { company?: { name?: string | null } | { name?: string | null }[] | null }).company
    const companyName = Array.isArray(company) ? company[0]?.name ?? null : company?.name ?? null
    return {
      id: String(r.id),
      created_at: String(r.created_at),
      level: r.level as ErrorLogRow["level"],
      source: r.source as ErrorLogRow["source"],
      message: String(r.message),
      stack: r.stack ?? null,
      digest: r.digest ?? null,
      route: r.route ?? null,
      method: r.method ?? null,
      status_code: r.status_code ?? null,
      company_id: r.company_id ?? null,
      company_name: companyName,
      user_id: r.user_id ?? null,
      user_email: r.user_email ?? null,
      user_agent: r.user_agent ?? null,
      context: (r.context as Record<string, unknown>) ?? {},
      fingerprint: String(r.fingerprint),
      resolved: Boolean(r.resolved),
      resolved_at: r.resolved_at ?? null,
    }
  })

  const groupMap = new Map<string, ErrorGroup>()
  for (const row of rows) {
    const existing = groupMap.get(row.fingerprint)
    if (!existing) {
      groupMap.set(row.fingerprint, {
        fingerprint: row.fingerprint,
        message: row.message,
        level: row.level,
        source: row.source,
        count: 1,
        resolved: row.resolved,
        firstSeen: row.created_at,
        lastSeen: row.created_at,
        routes: row.route ? [row.route] : [],
        affectedCompanies: 0,
        affectedUsers: 0,
        occurrences: [row],
      })
    } else {
      existing.count += 1
      existing.occurrences.push(row)
      if (row.created_at < existing.firstSeen) existing.firstSeen = row.created_at
      if (row.created_at > existing.lastSeen) existing.lastSeen = row.created_at
      // A group is "resolved" only if every occurrence in the window is resolved.
      existing.resolved = existing.resolved && row.resolved
      // Keep the highest severity seen for the group.
      if (LEVEL_RANK[row.level] > LEVEL_RANK[existing.level]) existing.level = row.level
      if (row.route && !existing.routes.includes(row.route)) existing.routes.push(row.route)
    }
  }

  const groups = Array.from(groupMap.values())
  for (const group of groups) {
    group.affectedCompanies = new Set(group.occurrences.map((o) => o.company_id).filter(Boolean)).size
    group.affectedUsers = new Set(group.occurrences.map((o) => o.user_id).filter(Boolean)).size
    // Most recent occurrences first within a group (occurrences came in desc already).
    group.occurrences = group.occurrences.slice(0, 20)
  }
  // Unresolved first, then by most recent occurrence.
  groups.sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1
    return b.lastSeen.localeCompare(a.lastSeen)
  })

  const unresolvedRows = rows.filter((r) => !r.resolved)
  const summary = {
    unresolvedGroups: groups.filter((g) => !g.resolved).length,
    unresolvedOccurrences: unresolvedRows.length,
    fatalUnresolved: unresolvedRows.filter((r) => r.level === "fatal").length,
    last24h: rows.filter((r) => r.created_at >= dayAgo).length,
  }

  return { groups, summary }
}

/** Count of unresolved error occurrences — for the sidebar/overview badge. */
export async function countUnresolvedErrors(): Promise<number> {
  try {
    const admin = createAdminClient()
    const { count } = await admin
      .from("error_logs")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false)
    return count ?? 0
  } catch {
    return 0
  }
}
