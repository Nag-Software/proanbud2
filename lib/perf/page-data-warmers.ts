import { ensureFolder, ensureIntegrations, ensureRootFolders } from "@/components/dokumenter/data/documents-store"
import {
  CALENDAR_KEYS,
  calendarRangeFor,
  fetchCalendarEvents,
  fetchCalendarIntegrations,
  fetchCalendarProjects,
} from "@/lib/calendar/client-data"
import { fetchHourlyRates, fetchPriceFiles, fetchSavedJobs, MINE_PRISER_KEYS } from "@/lib/mine-priser/client-api"
import { fetchPrefetched } from "@/lib/perf/prefetch-cache"

/**
 * Datavarming for sider som henter dataene sine i nettleseren etter at siden
 * er vist. Å forvarme ruten alene gir dem bare skallet; her fyller vi også
 * cachene sidene leser fra, så innholdet står klart ved første klikk.
 *
 * Kjøres av RouteWarmer som egne oppgaver i samme kø som rutene — én om
 * gangen og bare når brukeren er inaktiv — derfor returnerer hver varmer et
 * løfte som løses når hentingen er ferdig.
 */

// Hvor gamle data som er gode nok til at forvarmingen lar være å hente på nytt.
const WARM_MAX_AGE_MS = 60_000

// Dokumentlageret har ingen løfter utad (fyr-og-glem); gi kallene litt tid
// før køen går videre, så de ikke overlapper med neste forvarming.
const FIRE_AND_FORGET_WAIT_MS = 800

type WarmContext = { userId: string }

function settled(promise: Promise<unknown>): Promise<void> {
  return promise.then(
    () => undefined,
    () => undefined
  )
}

const WARMERS: Record<string, (context: WarmContext) => Promise<void>> = {
  "/dokumenter": () => {
    // Samme tre kall som DocumentsManager gjør ved åpning (rotmappen i Proanbud-lagringen).
    ensureIntegrations()
    ensureRootFolders("supabase")
    ensureFolder("supabase", null)
    return new Promise((resolve) => setTimeout(resolve, FIRE_AND_FORGET_WAIT_MS))
  },
  "/mine-priser/prisfiler": () =>
    settled(fetchPrefetched(MINE_PRISER_KEYS.prisfiler, fetchPriceFiles, { maxAgeMs: WARM_MAX_AGE_MS })),
  "/mine-priser/lagrede-jobber": () =>
    settled(fetchPrefetched(MINE_PRISER_KEYS.lagredeJobber, fetchSavedJobs, { maxAgeMs: WARM_MAX_AGE_MS })),
  "/mine-priser/timepriser": () =>
    settled(fetchPrefetched(MINE_PRISER_KEYS.timepriser, fetchHourlyRates, { maxAgeMs: WARM_MAX_AGE_MS })),
  "/kalender": ({ userId }) => {
    const range = calendarRangeFor(new Date())
    return settled(
      Promise.all([
        fetchPrefetched(CALENDAR_KEYS.integrations(userId), () => fetchCalendarIntegrations(userId), {
          maxAgeMs: WARM_MAX_AGE_MS,
        }),
        fetchPrefetched(CALENDAR_KEYS.projects, fetchCalendarProjects, { maxAgeMs: WARM_MAX_AGE_MS }),
        fetchPrefetched(CALENDAR_KEYS.events(range), () => fetchCalendarEvents(range), {
          maxAgeMs: WARM_MAX_AGE_MS,
        }),
      ])
    )
  },
}

export function hasPageDataWarmer(href: string): boolean {
  return href in WARMERS
}

export function warmPageData(href: string, context: WarmContext): Promise<void> {
  return WARMERS[href]?.(context) ?? Promise.resolve()
}
