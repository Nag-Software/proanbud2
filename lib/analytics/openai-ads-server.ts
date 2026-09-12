import "server-only"
import { createHash } from "crypto"

import {
  CONSENT_COOKIE,
  OPENAI_ADS_PIXEL_ID,
  hasMeasurementConsent,
} from "@/lib/analytics/openai-ads"
import { logServerError } from "@/lib/errors/log"
import { createAdminClient } from "@/lib/supabase/admin"

/**
 * OpenAI Ads Conversions API — den AUTORITATIVE kanalen for konverteringer.
 *
 * Prøveperioden kan starte fra et Stripe-webhook, en bakgrunnsjobb eller en
 * admin-handling i /sjefen. I alle disse tilfellene ser nettleseren aldri noe,
 * så pixelen kan ikke være kilden vi stoler på. Nettleser-eventet er et
 * sekundært signal som kommer først når brukeren selv trykket på knappen.
 *
 * DEDUPLISERING: OpenAI dedupliserer på pixel-ID + eventnavn + `id`, og
 * beholder den FØRSTE de mottar. Derfor bruker begge kanaler prøveperiodens
 * egen ID (Stripe-abonnementets id) som event-ID. Bruk aldri en tilfeldig
 * verdi her — da telles konverteringen to ganger.
 *
 * API-nøkkelen er scoped til én annonsekonto og sendes som Bearer-token. Den
 * ligger i OPENAI_ADS_API_KEY (server-only) og skal ALDRI eksponeres i
 * klientkode — derfor "server-only" øverst i fila.
 */

const EVENTS_ENDPOINT = "https://bzr.openai.com/v1/events"

/**
 * `source_url` er påkrevd for web-events. Prøven starter ofte uten en
 * forespørsel å hente URL fra (webhook, cron), så vi faller tilbake til
 * appens egen signup-URL — det er nettadressen konverteringen hører til.
 */
const FALLBACK_SOURCE_URL = `${(
  process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://nye.proanbud.no"
).replace(/\/$/, "")}/signup`
const PROVIDER = "openai"
const INTEGRATION_SOURCE = "proanbud"

/**
 * E-posthashing gir bedre matching, men er PII — og analytics-laget vårt har
 * en «aldri PII»-linje. Av som standard; skru på med OPENAI_ADS_SEND_EMAIL_HASH=on.
 */
const SEND_EMAIL_HASH =
  process.env.OPENAI_ADS_SEND_EMAIL_HASH?.trim().toLowerCase() === "on"

function apiKey(): string | null {
  return process.env.OPENAI_ADS_API_KEY?.trim() || null
}

/** True når serverkanalen er ferdig konfigurert (pixel-ID + API-nøkkel). */
export function isOpenAiAdsServerEnabled(): boolean {
  return Boolean(OPENAI_ADS_PIXEL_ID && apiKey())
}

/** Normalisert SHA-256 av e-post, slik matching-APIer forventer den. */
function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex")
}

type ConversionUser = {
  obref?: string
  emails_sha256?: string[]
  ip_address?: string
  user_agent?: string
}

type ConversionEvent = {
  id: string
  type: string
  timestamp_ms: number
  oppref?: string
  source_url?: string
  user?: ConversionUser
  opt_out?: boolean
  data: { type: string; plan_id?: string }
}

/**
 * Send prøvestart-konverteringen for en bedrift.
 *
 * `trialId` MÅ være prøveperiodens egen ID (Stripe-abonnementets id) — samme
 * verdi nettleseren sender som event-ID.
 *
 * Best-effort og idempotent: journalen (ad_conversions) har en unik nøkkel på
 * (provider, event_name, event_id), så en webhook-retry eller et dobbeltkall
 * sender ingenting på nytt. Kaster aldri — en feilet konvertering skal ikke
 * velte prøvestarten.
 */
export async function reportTrialStarted(input: {
  companyId: string
  trialId: string
  planId?: string | null
  sourceUrl?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  /** Cookie-verdien til pa_consent fra forespørselen, når vi har en. */
  consentCookie?: string | null
}): Promise<void> {
  const key = apiKey()
  if (!OPENAI_ADS_PIXEL_ID || !key) return
  if (!input.trialId) return

  try {
    const admin = createAdminClient()

    const { data: company } = await admin
      .from("companies")
      .select("ad_oppref, ad_obref, email")
      .eq("id", input.companyId)
      .maybeSingle()

    // Ingen klikk-referanse = bedriften kom ikke fra en annonse. Vi sender
    // likevel ikke noe: uten oppref/obref kan OpenAI ikke knytte
    // konverteringen til et klikk, og støy hjelper ingen.
    const oppref = company?.ad_oppref?.trim() || null
    const obref = company?.ad_obref?.trim() || null
    if (!oppref && !obref) return

    // Idempotensport: vinner vi ikke INSERT-en, er konverteringen allerede
    // sendt (eller sendes akkurat nå av en parallell webhook-retry).
    const { data: claimed, error: claimError } = await admin
      .from("ad_conversions")
      .insert({
        provider: PROVIDER,
        event_name: "trial_started",
        event_id: input.trialId,
        company_id: input.companyId,
        oppref,
        obref,
      })
      .select("id")
      .maybeSingle()

    if (claimError) {
      // 23505 = unik konflikt → allerede sendt, ingenting å gjøre.
      if ((claimError as { code?: string }).code === "23505") return
      // 42P01 = tabellen finnes ikke (db/91 ikke kjørt) → feil lukket og stille.
      if ((claimError as { code?: string }).code === "42P01") return
      throw claimError
    }

    const consentDenied =
      input.consentCookie !== undefined &&
      !hasMeasurementConsent(input.consentCookie ?? null)

    const user: ConversionUser = {}
    if (obref) user.obref = obref
    if (input.ipAddress) user.ip_address = input.ipAddress
    if (input.userAgent) user.user_agent = input.userAgent
    if (SEND_EMAIL_HASH && company?.email) {
      user.emails_sha256 = [hashEmail(company.email)]
    }

    const event: ConversionEvent = {
      id: input.trialId,
      type: "trial_started",
      timestamp_ms: Date.now(),
      data: { type: "plan_enrollment", plan_id: input.planId || "proff" },
    }
    if (oppref) event.oppref = oppref
    event.source_url = input.sourceUrl?.trim() || FALLBACK_SOURCE_URL
    if (Object.keys(user).length > 0) event.user = user
    // Brukeren har uttrykkelig sagt nei: vi sender eventet, men flagget som
    // opt-out, slik at OpenAI ikke bruker det til profilering.
    if (consentDenied) event.opt_out = true

    const response = await fetch(
      `${EVENTS_ENDPOINT}?pid=${encodeURIComponent(OPENAI_ADS_PIXEL_ID)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          validate_only: false,
          integration_source: INTEGRATION_SOURCE,
          events: [event],
        }),
      }
    )

    const body = response.ok ? null : (await response.text().catch(() => "")).slice(0, 500)

    if (claimed?.id) {
      await admin
        .from("ad_conversions")
        .update({ response_status: response.status, error: body })
        .eq("id", claimed.id)
    }

    if (!response.ok) {
      await logServerError({
        message: "OpenAI Ads: trial_started-konvertering ble avvist",
        level: "warning",
        source: "server",
        route: "reportTrialStarted",
        companyId: input.companyId,
        context: { status: response.status, body, trialId: input.trialId },
      })
    }
  } catch (error) {
    // Måling skal aldri velte en prøvestart.
    await logServerError({
      message: "OpenAI Ads: kunne ikke sende trial_started-konvertering",
      error,
      level: "warning",
      source: "server",
      route: "reportTrialStarted",
      companyId: input.companyId,
      context: { trialId: input.trialId },
    })
  }
}

/** Cookie-navnet serverkoden leser samtykke fra. Re-eksport for lesbarhet. */
export { CONSENT_COOKIE }
