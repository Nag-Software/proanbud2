/**
 * Tynn innpakning rundt posthog-js for produkt-analyse.
 *
 * Personvern først (GDPR, norsk SMB):
 * - Initialiseres KUN når NEXT_PUBLIC_POSTHOG_KEY er satt — uten nøkkel er
 *   alt her en total no-op (dev/preview uten nøkkel skal ikke støye).
 * - EU-host som standard (https://eu.i.posthog.com — PostHog EU-prosjekt).
 * - person_profiles: 'identified_only' — anonyme besøk lager ingen personprofil.
 * - autocapture av (vi vil ha kuraterte events, ikke DOM-støv), pageviews
 *   sendes manuelt, ingen session recording.
 * - Identifisering skjer med Supabase user.id (pseudonym) + company_id/rolle.
 *   ALDRI e-post, navn eller annen direkte PII.
 *
 * posthog-js lastes LAZY (dynamic import): ~50 kB gzip holdes ute av appens
 * kritiske first-load-bundle. Uten nøkkel lastes chunken aldri. Alle kall er
 * fire-and-forget; events som fyres før chunken er lastet, kjøres i kø-orden
 * når den er klar (kjeding på samme promise bevarer rekkefølgen).
 */
import type posthogType from "posthog-js"

type PostHogClient = typeof posthogType

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com"

let loadPromise: Promise<PostHogClient | null> | null = null

/** True når analyse er aktiv (nøkkel satt + kjører i nettleser). */
export function isAnalyticsEnabled(): boolean {
  return typeof window !== "undefined" && Boolean(POSTHOG_KEY)
}

/**
 * Last + initialiser posthog-js én gang (lazy chunk). Trygg å kalle fra flere
 * steder; alle får samme promise. Resolver null uten nøkkel eller ved feil —
 * analyse er «best effort» og skal aldri knekke appen.
 */
function ensurePosthog(): Promise<PostHogClient | null> {
  if (!isAnalyticsEnabled() || !POSTHOG_KEY) return Promise.resolve(null)
  if (!loadPromise) {
    loadPromise = import("posthog-js")
      .then(({ default: posthog }) => {
        try {
          posthog.init(POSTHOG_KEY, {
            api_host: POSTHOG_HOST,
            person_profiles: "identified_only",
            autocapture: false,
            capture_pageview: false,
            disable_session_recording: true,
          })
          return posthog
        } catch {
          return null
        }
      })
      .catch(() => null)
  }
  return loadPromise
}

/**
 * Start lastingen i bakgrunnen (kalles fra provideren ved mount). Returnerer
 * om analyse er aktiv — selve initialiseringen skjer asynkront.
 */
export function initAnalytics(): boolean {
  if (!isAnalyticsEnabled()) return false
  void ensurePosthog()
  return true
}

/** Send ett event. Total no-op uten nøkkel; feil svelges. */
export function captureEvent(
  event: string,
  properties?: Record<string, unknown>
) {
  if (!isAnalyticsEnabled()) return
  void ensurePosthog().then((posthog) => {
    try {
      posthog?.capture(event, properties)
    } catch {
      // Aldri la analyse forstyrre brukeren.
    }
  })
}

/**
 * Knytt events til innlogget bruker. KUN pseudonym id + company_id/rolle —
 * aldri e-post eller navn (PII-minimering).
 */
export function identifyAnalyticsUser(
  distinctId: string,
  properties: { company_id: string | null; role: string | null }
) {
  if (!isAnalyticsEnabled()) return
  void ensurePosthog().then((posthog) => {
    try {
      posthog?.identify(distinctId, properties)
    } catch {
      // Best effort.
    }
  })
}

/** Nullstill identitet ved utlogging, så en delt enhet ikke arver forrige bruker. */
export function resetAnalyticsIdentity() {
  // Aldri initialisert (eller ikke engang påbegynt) → ingenting å nullstille.
  if (!loadPromise) return
  void loadPromise.then((posthog) => {
    try {
      posthog?.reset()
    } catch {
      // Best effort.
    }
  })
}
