/**
 * OpenAI Ads (ChatGPT) — måling i nettleseren.
 *
 * Samme filosofi som lib/analytics/posthog.ts: total no-op når pixel-ID-en
 * mangler, alle kall er fire-and-forget, og ingenting her får lov til å knekke
 * appen. Forskjellen er at SDK-en lastes av pixel-snutten i <head>
 * (components/analytics/openai-pixel.tsx) — her snakker vi bare med kø-en
 * `window.oaiq`, som finnes fra første byte og tar imot kall før SDK-en er
 * lastet.
 *
 * Personvern: samtykke leses fra `pa_consent`-cookien (satt på .proanbud.no av
 * markedssiden) og sendes som oaiq("consent", …) i SAMME kall-kø som init, før
 * noe event kan rekke å gå ut. Bare et uttrykkelig «denied» slår av måling —
 * har brukeren ikke tatt stilling, måler vi.
 *
 * Konverteringen (trial_started) speiles server-side via Conversions API, se
 * lib/analytics/openai-ads-server.ts. Nettleserkanalen er et sekundært signal:
 * prøven kan starte fra en webhook eller en bakgrunnsjobb der nettleseren
 * aldri ser noe. Begge kanaler MÅ bruke samme event-ID, ellers telles
 * konverteringen to ganger.
 */

/**
 * Pixel-ID for annonsekontoen. Samme ID som markedssiden (proanbud.no) bruker
 * — måling på tvers av de to domenene MÅ ligge på samme pixel, ellers kan
 * ikke klikk og konvertering knyttes sammen.
 *
 * Overstyrbar via env (f.eks. for en testpixel), med den faktiske ID-en som
 * standard slik at prod ikke slutter å måle om variabelen mangler i Vercel.
 * Tom verdi = hele modulen er en no-op.
 */
export const OPENAI_ADS_PIXEL_ID =
  process.env.NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID ?? "UWKwj3FZm8Qh9wWzi6RWPx"

/** SDK-en pixel-snutten laster. */
export const OPENAI_ADS_SDK_URL = "https://bzrcdn.openai.com/sdk/oaiq.min.js"

/** Cookie markedssiden setter med klikk-referansen fra annonsen. */
export const OPPREF_COOKIE = "__oppref"
/** Cookie pixelen setter med sin opake nettleser-referanse. */
export const OBREF_COOKIE = "__obref"
/** Samtykke-cookie satt på .proanbud.no ("granted" / "denied"). */
export const CONSENT_COOKIE = "pa_consent"

/** Query-parameteren /start sender med til signup-URL-en. */
export const OPPREF_QUERY_PARAM = "oppref"

/**
 * Refs vi bærer gjennom registreringen. `sessionStorage` er sikkerhetsnettet:
 * krever kontoen e-postbekreftelse, er URL-parameteren borte når brukeren
 * kommer tilbake, og cookien kan mangle (annen nettleser enn den som klikket).
 */
const REFS_STORAGE_KEY = "pa_ad_refs"

declare global {
  interface Window {
    oaiq?: ((...args: unknown[]) => void) & { q?: unknown[] }
  }
}

export type AdClickRefs = {
  oppref: string | null
  obref: string | null
}

/** True når pixelen er aktiv (ID satt + vi kjører i nettleser). */
export function isOpenAiAdsEnabled(): boolean {
  return typeof window !== "undefined" && Boolean(OPENAI_ADS_PIXEL_ID)
}

/** Les én cookie i nettleseren. Returnerer null utenfor nettleser. */
export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null
  const prefix = `${name}=`
  for (const part of document.cookie.split("; ")) {
    if (part.startsWith(prefix)) {
      const raw = part.slice(prefix.length)
      try {
        return decodeURIComponent(raw) || null
      } catch {
        return raw || null
      }
    }
  }
  return null
}

/**
 * Samtykke slik pixelen skal se det: false KUN ved et uttrykkelig «denied».
 * Ingen cookie = brukeren har ikke tatt stilling = vi måler.
 */
export function hasMeasurementConsent(rawCookieValue: string | null): boolean {
  return rawCookieValue?.trim().toLowerCase() !== "denied"
}

/**
 * Send ett event til pixelen. Total no-op uten pixel-ID; feil svelges.
 *
 * `eventId` er dedupliseringsnøkkelen mot Conversions API — send ALLTID den
 * samme verdien som serverkanalen bruker som `id` (for prøveperioder:
 * prøveperiodens egen ID, aldri en tilfeldig verdi).
 *
 * MERK opsjonsnøkkelen: SDK-en vil ha `event_id`. `{ id: … }` blir STILLE
 * forkastet («validation failed; event dropped» i debug-konsollen) — eventet
 * går enten ikke ut, eller ut uten ID, og da har serverkanalen ingenting å
 * deduplisere mot og konverteringen telles to ganger. Verifisert mot den
 * faktiske oaiq.min.js, ikke gjettet.
 */
export function measureAdEvent(
  eventName: string,
  eventData: Record<string, unknown>,
  eventId?: string | null
) {
  if (!isOpenAiAdsEnabled()) return
  try {
    const options = eventId ? { event_id: eventId } : undefined
    window.oaiq?.("measure", eventName, eventData, options)
  } catch {
    // Måling skal aldri forstyrre brukeren.
  }
}

/**
 * Plukk klikk-referansene: `oppref` fra URL-en (det /start sender med), med
 * `__oppref`-cookien som fallback, og `__obref` fra pixelens egen cookie.
 * Leser til slutt fra sessionStorage hvis begge kildene er tomme.
 */
export function readAdClickRefs(searchParamValue?: string | null): AdClickRefs {
  if (typeof window === "undefined") return { oppref: null, obref: null }

  const fromUrl =
    searchParamValue?.trim() ||
    new URLSearchParams(window.location.search).get(OPPREF_QUERY_PARAM)?.trim() ||
    null

  const stored = readStoredAdClickRefs()

  const refs: AdClickRefs = {
    oppref: fromUrl || readCookie(OPPREF_COOKIE) || stored.oppref,
    obref: readCookie(OBREF_COOKIE) || stored.obref,
  }

  // Hold sikkerhetsnettet oppdatert så refs overlever en e-postbekreftelse
  // som tar brukeren ut av og inn i appen igjen.
  if (refs.oppref || refs.obref) storeAdClickRefs(refs)

  return refs
}

function readStoredAdClickRefs(): AdClickRefs {
  try {
    const raw = window.sessionStorage.getItem(REFS_STORAGE_KEY)
    if (!raw) return { oppref: null, obref: null }
    const parsed = JSON.parse(raw) as Partial<AdClickRefs>
    return {
      oppref: typeof parsed.oppref === "string" ? parsed.oppref : null,
      obref: typeof parsed.obref === "string" ? parsed.obref : null,
    }
  } catch {
    // Privat modus / blokkert lagring — vi klarer oss uten.
    return { oppref: null, obref: null }
  }
}

function storeAdClickRefs(refs: AdClickRefs) {
  try {
    window.sessionStorage.setItem(REFS_STORAGE_KEY, JSON.stringify(refs))
  } catch {
    // Best effort.
  }
}

/**
 * Lagre klikk-referansene varig på brukeren, og fyr `registration_completed`
 * som sekundært signal. INGEN konvertering sendes her — konverteringen vi
 * optimaliserer mot er prøvestart, og den skjer senere.
 *
 * Kalles rett etter at kontoen er opprettet. Best-effort hele veien:
 * feiler lagringen, skal registreringen likevel gå gjennom.
 */
export async function recordSignupAttribution(
  searchParamValue?: string | null
): Promise<void> {
  const refs = readAdClickRefs(searchParamValue)

  measureAdEvent("registration_completed", { type: "customer_action" })

  if (!refs.oppref && !refs.obref) return

  try {
    await fetch("/api/attribution/ad-click", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(refs),
      keepalive: true,
    })
  } catch {
    // Attribusjon må aldri blokkere registreringen. Refs ligger fortsatt i
    // cookie/sessionStorage, og firmaopprettelsen plukker dem opp derfra.
  }
}
