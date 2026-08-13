// Bilde av et sted (hus/tomt) hentet fra en adresse. Brukes av prosjektkortene
// slik at håndverkeren kjenner igjen bygget uten å lese teksten.
//
// Kjeden er bevisst degraderende, så funksjonen virker uansett hvilke nøkler som
// er satt:
//   1. Google Street View  — ekte foto av huset fra veien (best)
//   2. Google Static Maps  — satellittbilde av tomta (når Street View mangler)
//   3. Kartverket-kart     — gratis og uten nøkkel, viser bygningsomrisset
//   4. null                — kortet viser en rolig plassholder
//
// MapTiler ble vurdert som gratis-alternativ, men Static Maps-API-et svarer 403
// på abonnementet vårt (geokodingen og tiles virker — det er bare statiske
// bilder som ikke er med). Kartverket er derfor det som faktisk fungerer uten
// Google-nøkkel.
//
// Kun server-side: Google-nøkkelen er hemmelig og skal aldri nå klienten.

import { geocodeAddress } from "@/lib/geo/geocode"

export type PlaceImage = {
  body: ArrayBuffer
  contentType: string
  /** Hvilken kilde bildet kom fra — logges/eksponeres som header for feilsøking. */
  source: "streetview" | "google-satellite" | "kartverket-kart"
}

/** Én adresse å prøve, med koordinater om vi allerede har dem. */
export type PlaceQuery = {
  address: string
  lat?: number | null
  lng?: number | null
}

const WIDTH = 640
const HEIGHT = 400
/** Hvor bredt utsnitt kartfallbacken viser — nok til huset og litt av tomta. */
const GROUND_WIDTH_M = 180

// Bildet av en adresse endrer seg praktisk talt aldri. En måned i Next sin
// data-cache betyr at hvert prosjekt koster ett kall hos leverandøren i måneden,
// uansett hvor mange som åpner prosjektoversikten.
const UPSTREAM_REVALIDATE_SECONDS = 60 * 60 * 24 * 30

/**
 * Beste tilgjengelige bilde for én eller flere kandidatadresser — første treff
 * vinner, eller null om ingen av dem gir noe.
 *
 * Flere kandidater fordi byggeplassadressen ofte er skrevet på slump
 * («Marcus Thranesvei 12» der matrikkelen sier «Marcus Thranes veg 12»). Da er
 * kundens registrerte adresse et bedre forsøk enn ingen bilde i det hele tatt.
 */
export async function getPlaceImage(queries: PlaceQuery[]): Promise<PlaceImage | null> {
  const googleKey = process.env.GOOGLE_MAPS_API_KEY?.trim()
  const candidates = queries
    .map((query) => ({ ...query, address: normalizeAddress(query.address) }))
    .filter((query): query is PlaceQuery & { address: string } => query.address !== null)

  if (googleKey) {
    // Street View først for ALLE adressene før vi vurderer noe ovenfra: et foto
    // fra veien er det håndverkeren faktisk kjenner igjen når han kjører fram.
    for (const candidate of candidates) {
      const streetView = await fetchStreetView(googleQuery(candidate.address), googleKey)
      if (streetView) return streetView
    }

    // Ingen Street View i nærheten (typisk hytte- og anleggsadresser). Da er
    // satellitt bedre enn ingenting, selv om utsnittet blir rett ovenfra.
    for (const candidate of candidates) {
      const satellite = await fetchGoogleSatellite(googleQuery(candidate.address), googleKey)
      if (satellite) return satellite
    }
  }

  for (const candidate of candidates) {
    // Kartverket slår opp i matrikkelen og vil ha adressen ren — et «, Norge»
    // på slutten gjør at søket ikke treffer i det hele tatt.
    const map = await fetchKartverketMap(candidate.address, candidate)
    if (map) return map
  }

  return null
}

/** Uten landkontekst treffer Google gjerne en likelydende gate i utlandet. */
function googleQuery(address: string) {
  return /norge|norway/i.test(address) ? address : `${address}, Norge`
}

/** Adressen som skal slås opp, eller null om det ikke er nok å gå på. */
export function normalizeAddress(address: string | null | undefined): string | null {
  const trimmed = (address || "").trim().replace(/\s+/g, " ")
  if (trimmed.length < 4) return null
  return trimmed.slice(0, 200)
}

async function fetchStreetView(query: string, key: string): Promise<PlaceImage | null> {
  // Uten `heading` sikter Google kameraet mot adressen fra det nærmeste
  // fotopunktet — altså mot huset, ikke nedover gata. `pitch=10` løfter blikket
  // litt så taket blir med på småhus.
  //
  // `source=outdoor` holder oss unna innendørspanoramaer fra butikker og
  // kontorer, `radius` utvider fra Googles 50 m så spredtbygde adresser også får
  // et bilde fra veien, og `return_error_code` gir 404 i stedet for et grått
  // «ingen bilde»-bilde — ellers hadde vi cachet plassholderen som om den var et hus.
  const url =
    `https://maps.googleapis.com/maps/api/streetview` +
    `?size=${WIDTH}x${HEIGHT}` +
    `&location=${encodeURIComponent(query)}` +
    `&fov=75&pitch=10&radius=150&source=outdoor&return_error_code=true&key=${key}`

  return fetchImage(url, "streetview")
}

async function fetchGoogleSatellite(query: string, key: string): Promise<PlaceImage | null> {
  const url =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${encodeURIComponent(query)}` +
    `&zoom=19&size=${WIDTH}x${HEIGHT}&scale=2&maptype=satellite&format=jpg&key=${key}`

  return fetchImage(url, "google-satellite")
}

/**
 * Kartverkets åpne WMS — gratis, uten nøkkel og med bygningsomriss, så kortet
 * viser i det minste tomta til man har lagt inn en Google-nøkkel.
 */
async function fetchKartverketMap(
  query: string,
  coords?: { lat?: number | null; lng?: number | null }
): Promise<PlaceImage | null> {
  let lat = typeof coords?.lat === "number" ? coords.lat : null
  let lng = typeof coords?.lng === "number" ? coords.lng : null

  if (lat === null || lng === null) {
    const point = await geocodeAddress(query)
    if (!point) return null
    lat = point.lat
    lng = point.lng
  }

  const [x, y] = toWebMercator(lat, lng)
  // Web Mercator-meter er strukket med 1/cos(lat), så vi deler for å få et
  // utsnitt som faktisk er ~GROUND_WIDTH_M bredt på bakken.
  const halfWidth = GROUND_WIDTH_M / 2 / Math.cos((lat * Math.PI) / 180)
  const halfHeight = (halfWidth * HEIGHT) / WIDTH

  const bbox = [x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight].join(",")
  const url =
    `https://wms.geonorge.no/skwms1/wms.topo` +
    `?service=WMS&version=1.3.0&request=GetMap&layers=topo` +
    `&crs=EPSG:3857&bbox=${bbox}&width=${WIDTH}&height=${HEIGHT}&format=image/png`

  return fetchImage(url, "kartverket-kart")
}

/** WGS84 → EPSG:3857 (meter), slik WMS-en vil ha bbox-en. */
function toWebMercator(lat: number, lng: number): [number, number] {
  const x = (lng * 20037508.34) / 180
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * (20037508.34 / 180)
  return [x, y]
}

async function fetchImage(url: string, source: PlaceImage["source"]): Promise<PlaceImage | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      next: { revalidate: UPSTREAM_REVALIDATE_SECONDS },
    })
    if (!res.ok) return null

    const contentType = res.headers.get("content-type") || ""
    // En feilmelding i JSON/HTML skal ikke ende opp som «bildet» på kortet.
    if (!contentType.startsWith("image/")) return null

    const body = await res.arrayBuffer()
    if (body.byteLength < 512) return null

    return { body, contentType, source }
  } catch {
    return null
  }
}
