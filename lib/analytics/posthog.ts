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
 */
import posthog from "posthog-js"

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY
const POSTHOG_HOST =
  process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://eu.i.posthog.com"

let initialized = false

/** True når analyse er aktiv (nøkkel satt + kjører i nettleser). */
export function isAnalyticsEnabled(): boolean {
  return typeof window !== "undefined" && Boolean(POSTHOG_KEY)
}

/**
 * Initialiser posthog-js én gang. Trygg å kalle fra flere steder — både
 * provideren og track() kaller denne, så kall-rekkefølgen spiller ingen rolle.
 * Returnerer false (og gjør ingenting) uten nøkkel.
 */
export function initAnalytics(): boolean {
  if (!isAnalyticsEnabled() || !POSTHOG_KEY) return false
  if (!initialized) {
    try {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        person_profiles: "identified_only",
        autocapture: false,
        capture_pageview: false,
        disable_session_recording: true,
      })
      initialized = true
    } catch {
      // Analyse er «best effort» — den skal aldri knekke appen.
      return false
    }
  }
  return true
}

/** Send ett event. Total no-op uten nøkkel; feil svelges. */
export function captureEvent(
  event: string,
  properties?: Record<string, unknown>
) {
  if (!initAnalytics()) return
  try {
    posthog.capture(event, properties)
  } catch {
    // Aldri la analyse forstyrre brukeren.
  }
}

/**
 * Knytt events til innlogget bruker. KUN pseudonym id + company_id/rolle —
 * aldri e-post eller navn (PII-minimering).
 */
export function identifyAnalyticsUser(
  distinctId: string,
  properties: { company_id: string | null; role: string | null }
) {
  if (!initAnalytics()) return
  try {
    posthog.identify(distinctId, properties)
  } catch {
    // Best effort.
  }
}

/** Nullstill identitet ved utlogging, så en delt enhet ikke arver forrige bruker. */
export function resetAnalyticsIdentity() {
  if (!initialized) return
  try {
    posthog.reset()
  } catch {
    // Best effort.
  }
}
