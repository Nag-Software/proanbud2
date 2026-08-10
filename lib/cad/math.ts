/**
 * Ren 2D-matte for CAD-kjernen. Ingen avhengigheter — importeres både fra
 * server (eksport, mengder) og klient (editor), og fra vitest.
 */

import type { Point } from "./types"

/** Alt i modellen avrundes til millimeter. Uten dette samler flyttallsfeil seg
 * opp gjennom dra-operasjoner til vegger som «nesten» møtes ikke lenger skjøtes. */
export const MM = 0.001

export function roundMm(value: number) {
  return Math.round(value / MM) * MM
}

export function roundPoint(p: Point): Point {
  return { x: roundMm(p.x), y: roundMm(p.y) }
}

export function add(a: Point, b: Point): Point {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Point, b: Point): Point {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(a: Point, k: number): Point {
  return { x: a.x * k, y: a.y * k }
}

export function dot(a: Point, b: Point) {
  return a.x * b.x + a.y * b.y
}

/** 2D-kryssprodukt (z-komponenten). Positiv = b ligger til venstre for a. */
export function cross(a: Point, b: Point) {
  return a.x * b.y - a.y * b.x
}

export function length(a: Point) {
  return Math.hypot(a.x, a.y)
}

export function distance(a: Point, b: Point) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function normalize(a: Point): Point {
  const len = length(a)
  if (len < 1e-9) return { x: 1, y: 0 }
  return { x: a.x / len, y: a.y / len }
}

/** 90° mot klokka — venstre normal sett i retning a. */
export function perpendicular(a: Point): Point {
  return { x: -a.y, y: a.x }
}

export function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}

export function rotate(p: Point, angleRad: number, origin: Point = { x: 0, y: 0 }): Point {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const dx = p.x - origin.x
  const dy = p.y - origin.y
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  }
}

export function degToRad(deg: number) {
  return (deg * Math.PI) / 180
}

export function radToDeg(rad: number) {
  return (rad * 180) / Math.PI
}

export function pointsEqual(a: Point, b: Point, tolerance = 1e-6) {
  return Math.abs(a.x - b.x) <= tolerance && Math.abs(a.y - b.y) <= tolerance
}

/** Signert areal. Positivt for polygon mot klokka (CCW). */
export function signedArea(points: Point[]) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    sum += a.x * b.y - b.x * a.y
  }
  return sum / 2
}

export function polygonArea(points: Point[]) {
  return Math.abs(signedArea(points))
}

export function polygonPerimeter(points: Point[]) {
  let sum = 0
  for (let i = 0; i < points.length; i++) {
    sum += distance(points[i], points[(i + 1) % points.length])
  }
  return sum
}

export function polygonCentroid(points: Point[]): Point {
  const area = signedArea(points)
  if (Math.abs(area) < 1e-9) {
    // Degenerert polygon — fall tilbake på gjennomsnittet av hjørnene.
    const sum = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0 })
    return scale(sum, 1 / Math.max(points.length, 1))
  }
  let cx = 0
  let cy = 0
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const f = a.x * b.y - b.x * a.y
    cx += (a.x + b.x) * f
    cy += (a.y + b.y) * f
  }
  return { x: cx / (6 * area), y: cy / (6 * area) }
}

export function ensureCounterClockwise(points: Point[]) {
  return signedArea(points) < 0 ? [...points].reverse() : points
}

export function boundingBox(points: Point[]) {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of points) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]
    const b = polygon[j]
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}

/** Nærmeste punkt på linjestykket a→b, med parameteren t ∈ [0, 1]. */
export function closestPointOnSegment(p: Point, a: Point, b: Point) {
  const ab = sub(b, a)
  const lengthSquared = dot(ab, ab)
  if (lengthSquared < 1e-12) return { point: a, t: 0, distance: distance(p, a) }
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / lengthSquared))
  const point = add(a, scale(ab, t))
  return { point, t, distance: distance(p, point) }
}

/**
 * Skjæring mellom to uendelige linjer gitt punkt + retning.
 * Returnerer null når linjene er (nesten) parallelle.
 */
export function lineIntersection(
  p1: Point,
  d1: Point,
  p2: Point,
  d2: Point,
  parallelEpsilon = 1e-7
): Point | null {
  const denominator = cross(d1, d2)
  if (Math.abs(denominator) < parallelEpsilon) return null
  const t = cross(sub(p2, p1), d2) / denominator
  return add(p1, scale(d1, t))
}

/** Skjæring mellom to linjestykker, kun når den ligger inne på begge. */
export function segmentIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
  epsilon = 1e-9
): Point | null {
  const d1 = sub(a2, a1)
  const d2 = sub(b2, b1)
  const denominator = cross(d1, d2)
  if (Math.abs(denominator) < 1e-12) return null
  const t = cross(sub(b1, a1), d2) / denominator
  const u = cross(sub(b1, a1), d1) / denominator
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) return null
  return add(a1, scale(d1, t))
}

export function snapToGrid(value: number, gridSize: number) {
  if (gridSize <= 0) return value
  return Math.round(value / gridSize) * gridSize
}

export function snapPointToGrid(p: Point, gridSize: number): Point {
  return { x: snapToGrid(p.x, gridSize), y: snapToGrid(p.y, gridSize) }
}

/**
 * Låser en retning til nærmeste multiplum av `stepDeg` (default 15°) — samme
 * oppførsel som Shift-lås i vanlige CAD-verktøy.
 */
export function snapAngle(from: Point, to: Point, stepDeg = 15): Point {
  const delta = sub(to, from)
  const len = length(delta)
  if (len < 1e-9) return to
  const step = degToRad(stepDeg)
  const angle = Math.round(Math.atan2(delta.y, delta.x) / step) * step
  return { x: from.x + Math.cos(angle) * len, y: from.y + Math.sin(angle) * len }
}

/**
 * Fjerner punkter som ligger oppå hverandre, inkludert mellom siste og første.
 *
 * Dobbeltklikk for å lukke en flate gir to punkter i samme posisjon, og KI-en
 * gjentar gjerne startpunktet til slutt. Begge deler lager et hjørne uten
 * retning, som velter triangulering og arealberegning. Derfor ryddes omriss
 * ALLTID gjennom denne før de brukes.
 */
export function dedupePolygon(points: Point[], tolerance = 1e-4): Point[] {
  const result: Point[] = []
  for (const point of points) {
    const previous = result[result.length - 1]
    if (previous && distance(previous, point) <= tolerance) continue
    result.push(point)
  }
  while (result.length > 1 && distance(result[0], result[result.length - 1]) <= tolerance) {
    result.pop()
  }
  return result
}

/**
 * Øreklipping (ear clipping) for enkle polygoner. Returnerer indekstripler.
 * Brukes til gulv-, tak- og romflater — polygonene der er små (titalls punkter),
 * så O(n²) er helt uproblematisk og vi slipper en ekstra avhengighet.
 */
export function triangulatePolygon(points: Point[]): number[] {
  const n = points.length
  if (n < 3) return []

  // Jobb alltid mot klokka slik at «inne i trekanten»-testen har riktig fortegn.
  const isCcw = signedArea(points) > 0
  const indices = Array.from({ length: n }, (_, i) => (isCcw ? i : n - 1 - i))
  const result: number[] = []

  let guard = 0
  while (indices.length > 3 && guard++ < n * n) {
    let earFound = false

    for (let i = 0; i < indices.length; i++) {
      const prev = indices[(i - 1 + indices.length) % indices.length]
      const current = indices[i]
      const next = indices[(i + 1) % indices.length]

      const a = points[prev]
      const b = points[current]
      const c = points[next]

      // Konveks hjørne?
      if (cross(sub(b, a), sub(c, b)) <= 0) continue

      // Ingen andre hjørner inni trekanten?
      let containsOther = false
      for (const index of indices) {
        if (index === prev || index === current || index === next) continue
        if (pointInTriangle(points[index], a, b, c)) {
          containsOther = true
          break
        }
      }
      if (containsOther) continue

      result.push(prev, current, next)
      indices.splice(i, 1)
      earFound = true
      break
    }

    // Selvskjærende eller degenerert polygon: øreklipping finner ingen gyldig
    // ear. Vi lukker resten som en vifte i stedet for å returnere et halvt
    // lokk — et litt feil tak er til å leve med, et hull i gulvet er det ikke.
    if (!earFound) {
      for (let i = 1; i < indices.length - 1; i++) {
        result.push(indices[0], indices[i], indices[i + 1])
      }
      return result
    }
  }

  if (indices.length === 3) {
    result.push(indices[0], indices[1], indices[2])
  }

  return result
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point) {
  const d1 = cross(sub(b, a), sub(p, a))
  const d2 = cross(sub(c, b), sub(p, b))
  const d3 = cross(sub(a, c), sub(p, c))
  const hasNegative = d1 < 0 || d2 < 0 || d3 < 0
  const hasPositive = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNegative && hasPositive)
}

/** Utvider (positiv) eller trekker inn (negativ) et polygon langs normalene. */
export function offsetPolygon(points: Point[], offset: number): Point[] {
  if (points.length < 3 || Math.abs(offset) < 1e-9) return points
  const ccw = ensureCounterClockwise(points)
  const result: Point[] = []

  for (let i = 0; i < ccw.length; i++) {
    const prev = ccw[(i - 1 + ccw.length) % ccw.length]
    const current = ccw[i]
    const next = ccw[(i + 1) % ccw.length]

    const dirIn = normalize(sub(current, prev))
    const dirOut = normalize(sub(next, current))
    // Utover for et CCW-polygon er høyre normal.
    const normalIn = { x: dirIn.y, y: -dirIn.x }
    const normalOut = { x: dirOut.y, y: -dirOut.x }

    const p1 = add(prev, scale(normalIn, offset))
    const p2 = add(current, scale(normalOut, offset))
    const intersection = lineIntersection(p1, dirIn, p2, dirOut)
    result.push(intersection ?? p2)
  }

  return result
}

export function formatMeters(value: number, decimals = 2) {
  return `${value.toFixed(decimals).replace(".", ",")} m`
}

export function formatMillimeters(value: number) {
  return `${Math.round(value * 1000)} mm`
}

export function formatArea(value: number, decimals = 1) {
  return `${value.toFixed(decimals).replace(".", ",")} m²`
}
