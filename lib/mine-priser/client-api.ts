/**
 * Hentere for «Mine priser»-sidene, delt mellom sidene selv og
 * bakgrunnsforvarmingen (lib/perf/page-data-warmers.ts). Ligger i en egen,
 * liten modul så forvarmingen i app-skallet ikke drar med seg de store
 * sidekomponentene.
 */

export const MINE_PRISER_KEYS = {
  prisfiler: "mine-priser:prisfiler",
  lagredeJobber: "mine-priser:lagrede-jobber",
  timepriser: "mine-priser:timepriser",
} as const

/** Siden revaliderer ikke ved åpning hvis dataene er yngre enn dette. */
export const MINE_PRISER_MOUNT_MAX_AGE_MS = 10_000

async function getList<T>(url: string, field: string, fallbackError: string): Promise<T[]> {
  const res = await fetch(url)
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(typeof data.error === "string" && data.error ? data.error : fallbackError)
  }
  const list = data[field]
  return Array.isArray(list) ? (list as T[]) : []
}

export function fetchPriceFiles<T>(): Promise<T[]> {
  return getList<T>("/api/mine-priser/prisfiler", "files", "Kunne ikke hente prisfiler")
}

export function fetchSavedJobs<T>(): Promise<T[]> {
  return getList<T>("/api/mine-priser/lagrede-jobber", "jobs", "Kunne ikke hente lagrede jobber")
}

export function fetchHourlyRates<T>(): Promise<T[]> {
  return getList<T>("/api/mine-priser/timepriser", "rates", "Kunne ikke hente timepriser")
}
