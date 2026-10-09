/**
 * Første berøring (UTM + annonseklikk-ID) — delt mellom middleware, API-ruta
 * som oppretter bedrifter, og /sjefen.
 *
 * Kjeden:
 *   landing (proanbud.no eller app.proanbud.no) med ?utm_… / gclid / fbclid
 *     → førsteparts-cookie `pa_utm` (markedssiden setter den på .proanbud.no,
 *       app-middleware setter den på app.proanbud.no når den mangler)
 *     → POST /api/companies leser cookien og skriver på companies (db/114).
 *
 * FØRSTE BERØRING VINNER: cookien settes aldri om den finnes, og kolonnene på
 * bedriften skrives aldri over. Google/Apple-OAuth og e-postbekreftelse mister
 * query-parametrene, så cookien er bæreren — samme mønster som pa_ref (affiliate)
 * og __oppref (OpenAI Ads).
 *
 * Ren TS uten Next-avhengigheter, så den kan brukes i middleware (edge) og
 * testes uten nettverk. Ingen PII: UTM-verdier er kampanjetekst, klikk-ID-er
 * er opake annonsereferanser.
 */

export const UTM_COOKIE = "pa_utm"
/** Attribusjonsvindu — samme som pa_ref på markedssiden (60 d) rundet opp. */
export const UTM_COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60

const MAX_VALUE_LENGTH = 200

/** Klikk-ID-parametre vi kjenner igjen, og annonsenettet de tilhører. */
const CLICK_ID_PARAMS: Record<string, string> = {
  gclid: "google",
  gbraid: "google",
  wbraid: "google",
  fbclid: "meta",
  ttclid: "tiktok",
  msclkid: "microsoft",
}

export type FirstTouch = {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  landing_path: string | null
  referrer_host: string | null
  click_network: string | null
  click_id: string | null
  /** ISO-tidspunkt for første berøring. */
  first_touch_at: string
}

/** Cookie-form: korte nøkler så verdien holder seg godt under 1 kB. */
type CookieShape = {
  s?: string
  m?: string
  c?: string
  t?: string
  co?: string
  lp?: string
  rh?: string
  cn?: string
  cid?: string
  at?: string
}

function clean(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().slice(0, MAX_VALUE_LENGTH)
  return trimmed || null
}

/** True når URL-en bærer noe vi vil huske (utm_* eller en kjent klikk-ID). */
export function hasAttributionParams(params: URLSearchParams): boolean {
  for (const key of params.keys()) {
    if (key.startsWith("utm_") || key in CLICK_ID_PARAMS) return true
  }
  return false
}

/** Bare vertsnavnet av en referrer — aldri sti eller query (kan bære PII). */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null
  try {
    return new URL(referrer).hostname.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * Plukk første berøring fra en URL. Returnerer null når URL-en ikke bærer
 * noen attribusjon — da skal ingen cookie settes.
 */
export function parseFirstTouch(input: {
  searchParams: URLSearchParams
  pathname: string
  referrer?: string | null
  now?: Date
}): FirstTouch | null {
  const { searchParams } = input
  if (!hasAttributionParams(searchParams)) return null

  let clickNetwork: string | null = null
  let clickId: string | null = null
  for (const [param, network] of Object.entries(CLICK_ID_PARAMS)) {
    const value = clean(searchParams.get(param))
    if (value) {
      clickNetwork = network
      clickId = value
      break
    }
  }

  // Egen referrer-host på samme domene (proanbud.no → app.proanbud.no) sier
  // ingenting om hvor trafikken kom fra — behold bare eksterne.
  const host = referrerHost(input.referrer)
  const externalHost = host && !host.endsWith("proanbud.no") ? host : null

  return {
    utm_source: clean(searchParams.get("utm_source")),
    utm_medium: clean(searchParams.get("utm_medium")),
    utm_campaign: clean(searchParams.get("utm_campaign")),
    utm_term: clean(searchParams.get("utm_term")),
    utm_content: clean(searchParams.get("utm_content")),
    landing_path: clean(input.pathname) ?? "/",
    referrer_host: externalHost,
    click_network: clickNetwork,
    click_id: clickId,
    first_touch_at: (input.now ?? new Date()).toISOString(),
  }
}

/**
 * Cookie-verdi: rå JSON med korte nøkler. IKKE URL-enkodet her — Next sin
 * `response.cookies.set` enkoder selv (og `cookies().get` dekoder), og
 * markedssiden enkoder når den skriver document.cookie. Dobbel enkoding ga
 * `%7B…` i cookien.
 */
export function serializeFirstTouch(touch: FirstTouch): string {
  const shape: CookieShape = {}
  if (touch.utm_source) shape.s = touch.utm_source
  if (touch.utm_medium) shape.m = touch.utm_medium
  if (touch.utm_campaign) shape.c = touch.utm_campaign
  if (touch.utm_term) shape.t = touch.utm_term
  if (touch.utm_content) shape.co = touch.utm_content
  if (touch.landing_path) shape.lp = touch.landing_path
  if (touch.referrer_host) shape.rh = touch.referrer_host
  if (touch.click_network) shape.cn = touch.click_network
  if (touch.click_id) shape.cid = touch.click_id
  shape.at = touch.first_touch_at
  return JSON.stringify(shape)
}

/**
 * Les cookie-verdien tilbake. Tåler både dekodet (Next `cookies().get`) og
 * fortsatt URL-enkodet verdi (rå `document.cookie`). Null ved tom/ødelagt
 * verdi — aldri kast.
 */
export function parseFirstTouchCookie(raw: string | null | undefined): FirstTouch | null {
  if (!raw) return null
  try {
    let text = raw.trim()
    if (!text.startsWith("{")) {
      try {
        text = decodeURIComponent(text)
      } catch {
        // Ugyldig enkoding — JSON.parse under feiler og vi returnerer null.
      }
    }
    const shape = JSON.parse(text) as CookieShape
    if (!shape || typeof shape !== "object") return null
    const touch: FirstTouch = {
      utm_source: clean(shape.s),
      utm_medium: clean(shape.m),
      utm_campaign: clean(shape.c),
      utm_term: clean(shape.t),
      utm_content: clean(shape.co),
      landing_path: clean(shape.lp),
      referrer_host: clean(shape.rh),
      click_network: clean(shape.cn),
      click_id: clean(shape.cid),
      first_touch_at:
        typeof shape.at === "string" && !Number.isNaN(Date.parse(shape.at))
          ? new Date(shape.at).toISOString()
          : new Date().toISOString(),
    }
    const hasAnything =
      touch.utm_source ||
      touch.utm_medium ||
      touch.utm_campaign ||
      touch.utm_term ||
      touch.utm_content ||
      touch.click_id
    return hasAnything ? touch : null
  } catch {
    return null
  }
}

/** Kolonnene på companies (db/114) for en første berøring. */
export function firstTouchToCompanyColumns(touch: FirstTouch) {
  return {
    utm_source: touch.utm_source,
    utm_medium: touch.utm_medium,
    utm_campaign: touch.utm_campaign,
    utm_term: touch.utm_term,
    utm_content: touch.utm_content,
    acquisition_landing_path: touch.landing_path,
    acquisition_referrer_host: touch.referrer_host,
    acquisition_click_network: touch.click_network,
    acquisition_click_id: touch.click_id,
    acquisition_first_touch_at: touch.first_touch_at,
  }
}
