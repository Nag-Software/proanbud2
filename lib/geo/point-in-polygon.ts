// Ray-casting point-in-polygon for GeoJSON Polygon/MultiPolygon (WGS84 [lng,lat])
// + a metric distance, used to check whether a worker's GPS fix is inside a
// project geofence. No turf dependency.

export type AreaGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] }

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0]
    const yi = ring[i][1]
    const xj = ring[j][0]
    const yj = ring[j][1]
    const intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInPolygon(lng: number, lat: number, polygon: number[][][]): boolean {
  if (polygon.length === 0) return false
  // First ring is the outer boundary; any further rings are holes.
  if (!pointInRing(lng, lat, polygon[0])) return false
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lng, lat, polygon[i])) return false
  }
  return true
}

export function pointInArea(lng: number, lat: number, geom: AreaGeometry): boolean {
  if (geom.type === "Polygon") return pointInPolygon(lng, lat, geom.coordinates)
  return geom.coordinates.some((poly) => pointInPolygon(lng, lat, poly))
}

// Distance in metres from a point to a geofence area: 0 when inside, otherwise
// the shortest distance to any edge. Lets us accept a fix that is within N metres
// of the boundary (GPS-drift tolerance) for both Polygon and MultiPolygon.
export function distanceToAreaMeters(lng: number, lat: number, geom: AreaGeometry): number {
  if (pointInArea(lng, lat, geom)) return 0
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates
  let min = Infinity
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const d = pointToSegmentMeters(lng, lat, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1])
        if (d < min) min = d
      }
    }
  }
  return min
}

function pointToSegmentMeters(
  plng: number,
  plat: number,
  alng: number,
  alat: number,
  blng: number,
  blat: number
): number {
  // Local equirectangular projection to metres around the point's latitude.
  const mLat = 111320
  const mLng = 111320 * Math.cos((plat * Math.PI) / 180)
  const ax = (alng - plng) * mLng
  const ay = (alat - plat) * mLat
  const bx = (blng - plng) * mLng
  const by = (blat - plat) * mLat
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(cx, cy)
}

export function haversineMeters(aLng: number, aLat: number, bLng: number, bLat: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLng = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}
