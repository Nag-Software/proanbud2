/**
 * track() — kuraterte produkt-events til PostHog.
 *
 * Konvensjoner:
 * - NORSKE snake_case-eventnavn: 'stemplet_inn', 'prisfil_lastet_opp',
 *   'tilbud_sendt' …
 * - ALDRI PII i props (ingen e-post, navn, fritekst fra brukere).
 * - Total no-op når NEXT_PUBLIC_POSTHOG_KEY ikke er satt — trygt å kalle
 *   overalt uten miljøsjekker.
 */
import { captureEvent } from "@/lib/analytics/posthog"

export function track(event: string, props?: Record<string, unknown>) {
  captureEvent(event, props)
}
