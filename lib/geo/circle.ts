// GeoJSON circle polygon with no turf dependency. `radiusMeters` around
// [lng, lat] in WGS84, returned as a closed ring suitable for a MapLibre fill +
// line. Used to render project geofence circles (default 100 m fallback) until
// real cadastral polygons (matrikkel/teig) are wired in with the geofence
// feature. Equirectangular approximation — plenty accurate at ≤ a few hundred m.

// Local GeoJSON shape (the global `GeoJSON` namespace isn't in this tsconfig's
// types). Structurally assignable to MapLibre's setData() input.
export type GeoCircle = {
  type: "Feature"
  properties: Record<string, unknown>
  geometry: { type: "Polygon"; coordinates: [number, number][][] }
}

export function geoJsonCircle(
  lng: number,
  lat: number,
  radiusMeters: number,
  points = 64
): GeoCircle {
  const earth = 6378137
  const dLat = (radiusMeters / earth) * (180 / Math.PI)
  const dLng = dLat / Math.cos((lat * Math.PI) / 180)
  const ring: [number, number][] = []
  for (let i = 0; i <= points; i++) {
    const theta = (i / points) * 2 * Math.PI
    ring.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)])
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [ring] },
  }
}
