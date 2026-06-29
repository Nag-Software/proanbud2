// Cadastral property boundary (matrikkel / teig) lookup via Kartverket's open,
// keyless Eiendom-API. Given a WGS84 point it returns the property polygon(s) at
// that point as a GeoJSON MultiPolygon (already WGS84 lon/lat — no reprojection),
// plus the matrikkel id. One matrikkelenhet can have several teiger, so all
// returned polygons are merged into a MultiPolygon. Open data, CC BY 4.0
// (attribute Kartverket). Returns null when no property is found.

export type PropertyBoundary = {
  polygon: { type: "MultiPolygon"; coordinates: number[][][][] }
  kommunenr: string | null
  gnr: number | null
  bnr: number | null
  festenr: number | null
  teigCount: number
}

const EIENDOM_HOSTS = ["https://api.kartverket.no/eiendom/v1", "https://ws.geonorge.no/eiendom/v1"]

export async function fetchPropertyBoundary(lat: number, lng: number): Promise<PropertyBoundary | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  for (const host of EIENDOM_HOSTS) {
    try {
      // nord = latitude, ost = longitude. radius keeps it to the teig at the point.
      const url = `${host}/punkt/omrader?nord=${lat}&ost=${lng}&koordsys=4326&utkoordsys=4326&radius=8`
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) continue
      const data = (await res.json()) as { features?: EiendomFeature[] }
      const feats = Array.isArray(data?.features) ? data.features : []

      const polys: number[][][][] = []
      let props: EiendomProps | null = null
      for (const f of feats) {
        const g = f?.geometry
        if (!g || !Array.isArray(g.coordinates)) continue
        if (g.type === "Polygon") {
          polys.push(g.coordinates as number[][][])
          props = props ?? f.properties ?? null
        } else if (g.type === "MultiPolygon") {
          for (const p of g.coordinates as number[][][][]) polys.push(p)
          props = props ?? f.properties ?? null
        }
      }
      if (polys.length === 0) continue

      return {
        polygon: { type: "MultiPolygon", coordinates: polys },
        kommunenr: props?.kommunenummer ?? null,
        gnr: numOrNull(props?.gardsnummer),
        bnr: numOrNull(props?.bruksnummer),
        festenr: numOrNull(props?.festenummer),
        teigCount: polys.length,
      }
    } catch {
      // try next host
    }
  }
  return null
}

function numOrNull(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

type EiendomProps = {
  kommunenummer?: string
  gardsnummer?: number | string
  bruksnummer?: number | string
  festenummer?: number | string
}

type EiendomFeature = {
  geometry?: { type?: string; coordinates?: unknown }
  properties?: EiendomProps
}
