import "server-only"

/**
 * Server-side PostHog — for events nettleseren aldri ser.
 *
 * Prøve → betalende skjer i Stripe-webhooken, reconcile-cronen eller en
 * admin-handling, uten at noen er i appen. posthog-js (lib/analytics/posthog.ts)
 * kan derfor ikke være kilden; vi POST-er rett til capture-endepunktet med
 * prosjektnøkkelen (den samme offentlige nøkkelen nettleseren bruker — PostHog
 * har ingen hemmelig skrivenøkkel). Ingen ny pakke: posthog-node er ~100 kB
 * for ett fetch-kall.
 *
 * Samme linjer som klienten: total no-op uten NEXT_PUBLIC_POSTHOG_KEY, svelger
 * alle feil (måling skal aldri velte en billing-synk), og ALDRI PII i
 * properties — distinct_id er Supabase-bruker-id (pseudonym), som i
 * analytics-identify.tsx, så eventet lander på samme person som klient-eventene.
 */

const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() || null
const POSTHOG_HOST = (
  process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || "https://eu.i.posthog.com"
).replace(/\/$/, "")

export function isServerAnalyticsEnabled(): boolean {
  return Boolean(POSTHOG_KEY)
}

/**
 * Send ett event. Resolver true når PostHog svarte 2xx, ellers false — aldri
 * kast. `timeout` holder en treg PostHog unna webhook-fristen til Stripe.
 */
export async function captureServerEvent(input: {
  distinctId: string
  event: string
  properties?: Record<string, unknown>
  timestamp?: Date
}): Promise<boolean> {
  if (!POSTHOG_KEY) return false
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4000)
    try {
      const response = await fetch(`${POSTHOG_HOST}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: POSTHOG_KEY,
          event: input.event,
          distinct_id: input.distinctId,
          properties: {
            $lib: "proanbud-server",
            ...(input.properties ?? {}),
          },
          timestamp: (input.timestamp ?? new Date()).toISOString(),
        }),
        signal: controller.signal,
      })
      return response.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}
