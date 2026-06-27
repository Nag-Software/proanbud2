// Great-circle distance helpers. Used by the live GPS tracker to accumulate
// distance between fixes, and as the routing fallback when the directions proxy
// fails (straight-line "luftlinje" estimate the user can then correct).

export type LatLng = { lat: number; lng: number }

const EARTH_RADIUS_KM = 6371

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}

/** Great-circle distance between two points in kilometres. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Total length of a polyline in kilometres. Coordinates are [lng, lat] pairs
 * (GeoJSON order) to match how route_geometry is stored.
 */
export function polylineLengthKm(coords: Array<[number, number]>): number {
  if (!Array.isArray(coords) || coords.length < 2) return 0
  let total = 0
  for (let i = 1; i < coords.length; i++) {
    const [lng1, lat1] = coords[i - 1]
    const [lng2, lat2] = coords[i]
    total += haversineKm({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 })
  }
  return total
}
