import { NextResponse } from "next/server"

import { companyHasModule, getCurrentCompanyIdForUser } from "@/lib/billing/server-modules"
import { logServerError } from "@/lib/errors/log"
import { createClient } from "@/lib/supabase/server"
import type { GeocodeResult } from "@/lib/kjorebok/types"

// Address → coordinates. Primary source is Kartverket / Geonorge (free, no key,
// authoritative Norwegian address register); MapTiler is a fallback for POIs or
// non-address strings. Both run server-side so the MapTiler key never reaches the
// client and the lookup is gated behind the paid kjørebok module.

export async function GET(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await getCurrentCompanyIdForUser(user.id)
  if (!companyId || !(await companyHasModule(companyId, "kjorebok"))) {
    return NextResponse.json(
      { error: "Kjørebok er ikke aktivert", code: "module_required" },
      { status: 403 }
    )
  }

  const params = new URL(request.url).searchParams
  // Reverse mode is keyed off the PRESENCE of both params — Number(null) is 0
  // (finite), so checking finiteness alone would force every q-only autocomplete
  // request down the reverse branch and break address search entirely.
  const latRaw = params.get("lat")
  const lngRaw = params.get("lng")
  const lat = latRaw === null ? NaN : Number(latRaw)
  const lng = lngRaw === null ? NaN : Number(lngRaw)
  const reverse =
    latRaw !== null &&
    lngRaw !== null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  const q = (params.get("q") || "").trim().slice(0, 200)
  if (!reverse && q.length < 3) return NextResponse.json({ results: [] as GeocodeResult[] })

  try {
    if (reverse) {
      return NextResponse.json({ results: await reverseGeocodeKartverket(lat, lng) })
    }
    const primary = await geocodeKartverket(q)
    if (primary.length > 0) return NextResponse.json({ results: primary })
    const fallback = await geocodeMapTiler(q)
    return NextResponse.json({ results: fallback })
  } catch (error) {
    await logServerError({
      message: "Geokoding feilet",
      error,
      source: "api",
      route: "GET /api/kjorebok/geocode",
      context: { companyId, q, reverse },
    })
    return NextResponse.json({ results: [] as GeocodeResult[] })
  }
}

async function reverseGeocodeKartverket(lat: number, lng: number): Promise<GeocodeResult[]> {
  const url = `https://ws.geonorge.no/adresser/v1/punktsok?lat=${lat}&lon=${lng}&radius=120&treffPerSide=1`
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) return []
  const data = (await res.json()) as { adresser?: KartverketAddress[] }
  const a = Array.isArray(data?.adresser) ? data.adresser[0] : undefined
  if (!a) return []
  const postal = [a.postnummer, a.poststed].filter(Boolean).join(" ")
  const label = [a.adressetekst, postal].filter(Boolean).join(", ")
  // Echo back the queried point — the address text is what we want, the coords stay exact.
  return [{ label: label || a.adressetekst || `${lat.toFixed(4)}, ${lng.toFixed(4)}`, lat, lng, source: "kartverket" }]
}

async function geocodeKartverket(q: string): Promise<GeocodeResult[]> {
  const url = `https://ws.geonorge.no/adresser/v1/sok?sok=${encodeURIComponent(
    q
  )}&treffPerSide=6&fuzzy=true`
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) })
  if (!res.ok) return []
  const data = (await res.json()) as { adresser?: KartverketAddress[] }
  const list = Array.isArray(data?.adresser) ? data.adresser : []
  return list
    .map((a): GeocodeResult | null => {
      const lat = a?.representasjonspunkt?.lat
      const lng = a?.representasjonspunkt?.lon
      if (typeof lat !== "number" || typeof lng !== "number") return null
      const postal = [a.postnummer, a.poststed].filter(Boolean).join(" ")
      const label = [a.adressetekst, postal].filter(Boolean).join(", ")
      return { label: label || a.adressetekst || q, lat, lng, source: "kartverket" }
    })
    .filter((x): x is GeocodeResult => x !== null)
}

async function geocodeMapTiler(q: string): Promise<GeocodeResult[]> {
  const key = process.env.MAPTILER_KEY?.trim()
  if (!key) return []
  const url = `https://api.maptiler.com/geocoding/${encodeURIComponent(
    q
  )}.json?key=${key}&country=no&language=no&limit=6`
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) return []
  const data = (await res.json()) as { features?: MapTilerFeature[] }
  const features = Array.isArray(data?.features) ? data.features : []
  return features
    .map((f): GeocodeResult | null => {
      const center = f?.center || f?.geometry?.coordinates
      if (!Array.isArray(center) || center.length < 2) return null
      const [lng, lat] = center
      if (typeof lat !== "number" || typeof lng !== "number") return null
      return { label: f.place_name || f.text || q, lat, lng, source: "maptiler" }
    })
    .filter((x): x is GeocodeResult => x !== null)
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
