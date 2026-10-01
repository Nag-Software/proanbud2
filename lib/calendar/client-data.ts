import { addMonths, endOfMonth, startOfMonth, subMonths } from "date-fns"

import { createClient } from "@/lib/supabase/client"

/**
 * Hentere for kalendersiden, delt mellom siden selv og forhåndshentingen
 * (lib/perf/page-data-warmers.ts). Egen liten modul, så app-skallet ikke drar
 * med seg den store kalenderkomponenten.
 */

export const CALENDAR_KEYS = {
  integrations: (userId: string) => `kalender:integrasjoner:${userId}`,
  projects: "kalender:prosjekter",
  events: (range: CalendarRange) => `kalender:hendelser:${range.start}|${range.end}`,
}

/** Siden revaliderer ikke ved åpning hvis dataene er yngre enn dette. */
export const CALENDAR_MOUNT_MAX_AGE_MS = 10_000

export type CalendarRange = { start: string; end: string }

/** Hentevinduet rundt en dato: måneden, pluss én måned på hver side. */
export function calendarRangeFor(date: Date): CalendarRange {
  return {
    start: subMonths(startOfMonth(date), 1).toISOString(),
    end: addMonths(endOfMonth(date), 1).toISOString(),
  }
}

/** Hendelser slik API-et returnerer dem (datoer som strenger). */
export type RawCalendarEvent = {
  start: string
  end: string
  description?: string
  projectId?: string | null
  [key: string]: unknown
}

export class CalendarFetchError extends Error {
  constructor(readonly status: number) {
    super(`Kalenderhenting feilet (${status})`)
  }
}

export async function fetchCalendarEvents(range: CalendarRange): Promise<RawCalendarEvent[]> {
  const res = await fetch(
    `/api/calendar/events?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`
  )
  if (!res.ok) throw new CalendarFetchError(res.status)
  const data: unknown = await res.json()
  return Array.isArray(data) ? (data as RawCalendarEvent[]) : []
}

export async function fetchCalendarIntegrations(userId: string): Promise<{ provider: string }[]> {
  const { data, error } = await createClient()
    .from("calendar_integrations")
    .select("provider")
    .eq("user_id", userId)
  if (error) throw error
  return data ?? []
}

// Prosjektliste til «Koble til prosjekt» — RLS begrenser til brukerens egne prosjekter.
export async function fetchCalendarProjects(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await createClient()
    .from("projects")
    .select("id, name")
    .eq("status", "active")
    .order("name")
    .limit(100)
  if (error) throw error
  return data ?? []
}
