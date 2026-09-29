import { ensureFolder, ensureIntegrations, ensureRootFolders } from "@/components/dokumenter/data/documents-store"
import {
  CALENDAR_KEYS,
  calendarRangeFor,
  fetchCalendarEvents,
  fetchCalendarIntegrations,
  fetchCalendarProjects,
} from "@/lib/calendar/client-data"
import { fetchHourlyRates, fetchPriceFiles, fetchSavedJobs, MINE_PRISER_KEYS } from "@/lib/mine-priser/client-api"
import { warmPrefetched } from "@/lib/perf/prefetch-cache"

/**
 * Datavarming for sider som henter dataene sine i nettleseren etter at siden
 * er vist. Å forvarme ruten alene gir dem bare skallet; her fyller vi også
 * cachene sidene leser fra, så innholdet står klart ved første klikk.
 *
 * Kalles av RouteWarmer i samme takt som ruten varmes (maks hvert femte
 * minutt per side), aldri oftere.
 */

// Hvor gamle data som er gode nok til at forvarmingen lar være å hente på nytt.
const WARM_MAX_AGE_MS = 60_000

type WarmContext = { userId: string }

const WARMERS: Record<string, (context: WarmContext) => void> = {
  "/dokumenter": () => {
    // Samme tre kall som DocumentsManager gjør ved åpning (rotmappen i Proanbud-lagringen).
    ensureIntegrations()
    ensureRootFolders("supabase")
    ensureFolder("supabase", null)
  },
  "/mine-priser/prisfiler": () =>
    warmPrefetched(MINE_PRISER_KEYS.prisfiler, fetchPriceFiles, WARM_MAX_AGE_MS),
  "/mine-priser/lagrede-jobber": () =>
    warmPrefetched(MINE_PRISER_KEYS.lagredeJobber, fetchSavedJobs, WARM_MAX_AGE_MS),
  "/mine-priser/timepriser": () =>
    warmPrefetched(MINE_PRISER_KEYS.timepriser, fetchHourlyRates, WARM_MAX_AGE_MS),
  "/kalender": ({ userId }) => {
    const range = calendarRangeFor(new Date())
    warmPrefetched(CALENDAR_KEYS.integrations(userId), () => fetchCalendarIntegrations(userId), WARM_MAX_AGE_MS)
    warmPrefetched(CALENDAR_KEYS.projects, fetchCalendarProjects, WARM_MAX_AGE_MS)
    warmPrefetched(CALENDAR_KEYS.events(range), () => fetchCalendarEvents(range), WARM_MAX_AGE_MS)
  },
}

export function warmPageData(href: string, context: WarmContext) {
  WARMERS[href]?.(context)
}
