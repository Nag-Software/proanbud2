// Shared forward geocoder (address → coordinates). Module-agnostic so any
// feature can use it (kart, geofence, kjørebok). Primary source is Kartverket /
// Geonorge (free, no key, authoritative Norwegian address register); MapTiler is
// a fallback for POIs or non-address strings. Server-side only — MapTiler uses
// the server key, never the client one.

export type GeoPoint = {
  lat: number
  lng: number
  label: string
  source: "kartverket" | "maptiler"
}

/** Best single coordinate for a free-text address, or null if nothing matched. */
export async function geocodeAddress(query: string): Promise<GeoPoint | null> {
  const q = (query || "").trim()
  if (q.length < 3) return null
  const k = await geocodeKartverket(q)
  if (k) return k
  return geocodeMapTiler(q)
}

/** Ranked candidates for a free-text address (for autocomplete). */
export async function geocodeAddressMany(query: string, limit = 6): Promise<GeoPoint[]> {
  const q = (query || "").trim()
  if (q.length < 3) return []
  const k = await geocodeKartverketMany(q, limit)
  if (k.length > 0) return k
  return geocodeMapTilerMany(q, limit)
}

async function geocodeKartverketMany(q: string, limit: number): Promise<GeoPoint[]> {
  try {
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(
      q
    )}&treffPerSide=${Math.min(Math.max(limit, 1), 20)}&fuzzy=true`
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as { adresser?: KartverketAddress[] }
    const list = Array.isArray(data?.adresser) ? data.adresser : []
    return list
      .map((a): GeoPoint | null => {
        const lat = a?.representasjonspunkt?.lat
        const lng = a?.representasjonspunkt?.lon
        if (typeof lat !== "number" || typeof lng !== "number") return null
        const postal = [a?.postnummer, a?.poststed].filter(Boolean).join(" ")
        const label = [a?.adressetekst, postal].filter(Boolean).join(", ")
        return { lat, lng, label: label || a?.adressetekst || q, source: "kartverket" }
      })
      .filter((x): x is GeoPoint => x !== null)
  } catch {
    return []
  }
}

async function geocodeMapTilerMany(q: string, limit: number): Promise<GeoPoint[]> {
  try {
    const key = process.env.MAPTILER_KEY?.trim()
    if (!key) return []
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(
      q
    )}.json?key=${key}&country=no&language=no&limit=${Math.min(Math.max(limit, 1), 10)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return []
    const data = (await res.json()) as { features?: MapTilerFeature[] }
    const features = Array.isArray(data?.features) ? data.features : []
    return features
      .map((f): GeoPoint | null => {
        const center = f?.center || f?.geometry?.coordinates
        if (!Array.isArray(center) || center.length < 2) return null
        const [lng, lat] = center
        if (typeof lat !== "number" || typeof lng !== "number") return null
        return { lat, lng, label: f?.place_name || f?.text || q, source: "maptiler" }
      })
      .filter((x): x is GeoPoint => x !== null)
  } catch {
    return []
  }
}

async function geocodeKartverket(q: string): Promise<GeoPoint | null> {
  try {
    const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(
      q
    )}&treffPerSide=1&fuzzy=true`
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { adresser?: KartverketAddress[] }
    const a = Array.isArray(data?.adresser) ? data.adresser[0] : undefined
    const lat = a?.representasjonspunkt?.lat
    const lng = a?.representasjonspunkt?.lon
    if (typeof lat !== "number" || typeof lng !== "number") return null
    const postal = [a?.postnummer, a?.poststed].filter(Boolean).join(" ")
    const label = [a?.adressetekst, postal].filter(Boolean).join(", ")
    return { lat, lng, label: label || a?.adressetekst || q, source: "kartverket" }
  } catch {
    return null
  }
}

async function geocodeMapTiler(q: string): Promise<GeoPoint | null> {
  try {
    const key = process.env.MAPTILER_KEY?.trim()
    if (!key) return null
    const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(
      q
    )}.json?key=${key}&country=no&language=no&limit=1`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = (await res.json()) as { features?: MapTilerFeature[] }
    const f = Array.isArray(data?.features) ? data.features[0] : undefined
    const center = f?.center || f?.geometry?.coordinates
    if (!Array.isArray(center) || center.length < 2) return null
    const [lng, lat] = center
    if (typeof lat !== "number" || typeof lng !== "number") return null
    return { lat, lng, label: f?.place_name || f?.text || q, source: "maptiler" }
  } catch {
    return null
  }
}

type KartverketAddress = {
  adressetekst?: string
  postnummer?: string
  poststed?: string
  representasjonspunkt?: { lat?: number; lon?: number }
}

type MapTilerFeature = {
  place_name?: string
  text?: string
  center?: [number, number]
  geometry?: { coordinates?: [number, number] }
}
