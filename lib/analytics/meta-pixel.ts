/**
 * Meta (Facebook) Pixel — `CompleteRegistration` når et firma faktisk er
 * opprettet.
 *
 * Markedssiden (proanbud-new) sender `Lead` når noen trykker seg videre til
 * registrering. Det er en intensjon, ikke en kunde: uten et event herfra
 * optimaliserer Meta annonsene mot klikk, ikke mot opprettede kontoer.
 *
 * Samme oppskrift som lib/meta-pixel.ts på markedssiden: et rent bilde-kall mot
 * Metas /tr-endepunkt (går ut med én gang og overlever navigeringen rett
 * etterpå — appen laster ikke fbevents.js), pluss en serverside-tvilling via
 * Conversions API (app/api/meta/conversion). Begge bærer SAMME event-ID, som
 * Meta dedupliserer på, så registreringen telles én gang.
 *
 * Personvern: opt-in. Bare et uttrykkelig «granted» i `pa_consent`-cookien
 * (satt på .proanbud.no av markedssiden) slipper eventet ut — samme linje som
 * Meta-pixelen der. MERK at dette er strengere enn OpenAI-pixelen i appen, som
 * måler til brukeren sier nei.
 */

import { CONSENT_COOKIE, readCookie } from "@/lib/analytics/openai-ads"

/**
 * Samme pixel som markedssiden — klikk og konvertering MÅ ligge på samme
 * pixel for at Meta skal kunne knytte dem sammen. Tom verdi = total no-op.
 */
export const META_PIXEL_ID =
  process.env.NEXT_PUBLIC_FB_PIXEL_ID ?? "721076847281663"

const PIXEL_ENDPOINT = "https://www.facebook.com/tr"

/** Opt-in: bare et uttrykkelig ja i samtykkebanneret tillater Meta-måling. */
export function hasMetaConsent(rawCookieValue: string | null): boolean {
  return rawCookieValue?.trim().toLowerCase() === "granted"
}

/**
 * Event-ID for registreringen. Bygget på firmaets ID, ikke en tilfeldig verdi:
 * da gir et dobbeltklikk eller en retry samme ID, og Meta teller den én gang.
 */
export function registrationEventId(companyId: string): string {
  return `reg-${companyId}`
}

/** URL-en til bilde-kallet. Ren funksjon så parameterne kan testes. */
export function buildMetaPixelUrl(input: {
  pixelId: string
  event: string
  eventId: string
  pageUrl: string
  fbp?: string | null
  fbc?: string | null
}): string {
  const params = new URLSearchParams({
    id: input.pixelId,
    ev: input.event,
    dl: input.pageUrl,
    // `eid` er dedupliseringsnøkkelen mot Conversions API sin `event_id`.
    eid: input.eventId,
    noscript: "1",
  })
  // Førsteparts-cookiene fra fbevents.js på markedssiden (.proanbud.no). `_fbc`
  // er klikk-ID-en fra annonsen og det sterkeste matchesignalet vi har.
  if (input.fbp) params.set("fbp", input.fbp)
  if (input.fbc) params.set("fbc", input.fbc)
  return `${PIXEL_ENDPOINT}?${params.toString()}`
}

/**
 * Fyr `CompleteRegistration` for et nyopprettet firma. Trygg å kalle rett før
 * en navigering. Total no-op uten samtykke eller pixel-ID; feil svelges.
 */
export function trackMetaRegistration(companyId: string | null | undefined) {
  if (typeof window === "undefined" || !META_PIXEL_ID || !companyId) return
  if (!hasMetaConsent(readCookie(CONSENT_COOKIE))) return

  const eventId = registrationEventId(companyId)
  // Uten query-streng: den hører ikke hjemme hos en annonsepartner.
  const pageUrl = `${window.location.origin}${window.location.pathname}`

  try {
    new Image().src = buildMetaPixelUrl({
      pixelId: META_PIXEL_ID,
      event: "CompleteRegistration",
      eventId,
      pageUrl,
      fbp: readCookie("_fbp"),
      fbc: readCookie("_fbc"),
    })
  } catch {
    // Måling skal aldri forstyrre brukeren.
  }

  try {
    // `keepalive` lar requesten fullføre etter at siden er forlatt.
    void fetch("/api/meta/conversion", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventId, sourceUrl: pageUrl }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Se over: pixelen har uansett sendt eventet.
  }
}
