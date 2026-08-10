/**
 * Automatisk romdeteksjon.
 *
 * Veggene danner en plan graf. Rommene er de avgrensede flatene i den grafen.
 * Vi finner dem ved klassisk «neste kant med klokka»-traversering: fra en rettet
 * kant (u→v) velger vi i v den utgående kanten som ligger nærmest med klokka
 * fra returkanten (v→u). Det sporer alle avgrensede flater mot klokka, mens den
 * ytre flaten kommer ut med klokka (negativt areal) og faller ut av seg selv.
 *
 * Deretter trekkes flaten inn med halve veggtykkelsen på hver kant, slik at
 * arealet blir det INNVENDIGE romarealet (det håndverkeren fakturerer og
 * legger gulv på) — ikke senterlinjearealet.
 */

import {
  distance,
  closestPointOnSegment,
  lineIntersection,
  normalize,
  polygonArea,
  roundMm,
  scale,
  add,
  signedArea,
  sub,
} from "./math"
import { newId } from "./presets"
import type { Point, Space, Wall } from "./types"

const VERTEX_TOLERANCE = 0.005
/** Flater mindre enn dette er skjøtelommer mellom vegger, ikke rom. */
const MIN_ROOM_AREA = 0.6

type Segment = { a: Point; b: Point; wall: Wall }

function vertexKey(point: Point) {
  return `${Math.round(point.x / VERTEX_TOLERANCE)}:${Math.round(point.y / VERTEX_TOLERANCE)}`
}

/** Deler alle vegglinjer opp i knutepunktene sine, inkludert T-kryss. */
function splitSegments(walls: Wall[]): Segment[] {
  const result: Segment[] = []

  for (const wall of walls) {
    const length = distance(wall.a, wall.b)
    if (length < 1e-6) continue

    const cuts = new Set<number>([0, 1])

    for (const other of walls) {
      if (other.id === wall.id) continue
      for (const point of [other.a, other.b]) {
        const projection = closestPointOnSegment(point, wall.a, wall.b)
        if (projection.distance <= VERTEX_TOLERANCE) cuts.add(projection.t)
      }
    }

    const sorted = [...cuts].sort((left, right) => left - right)
    for (let i = 0; i < sorted.length - 1; i++) {
      const t0 = sorted[i]
      const t1 = sorted[i + 1]
      if ((t1 - t0) * length < VERTEX_TOLERANCE) continue
      result.push({
        a: {
          x: roundMm(wall.a.x + (wall.b.x - wall.a.x) * t0),
          y: roundMm(wall.a.y + (wall.b.y - wall.a.y) * t0),
        },
        b: {
          x: roundMm(wall.a.x + (wall.b.x - wall.a.x) * t1),
          y: roundMm(wall.a.y + (wall.b.y - wall.a.y) * t1),
        },
        wall,
      })
    }
  }

  return result
}

type HalfEdge = {
  from: string
  to: string
  angle: number
  wall: Wall
}

export type DetectedFace = {
  /** Senterlinjepolygonet (mellom veggenes senter). */
  outline: Point[]
  /** Innvendig polygon etter innsetting med halve veggtykkelser. */
  inner: Point[]
  area: number
  wallIds: string[]
}

type TracedCycle = { outline: Point[]; cycle: HalfEdge[]; signedArea: number }

/**
 * Sporer alle flatene i vegg-grafen, inkludert den ytre (som får negativt
 * areal). Både romdeteksjonen og ytterkonturen bygger på denne.
 */
export function traceCycles(walls: Wall[]): TracedCycle[] {
  const segments = splitSegments(walls)
  if (segments.length < 3) return []

  const points = new Map<string, Point>()
  const outgoing = new Map<string, HalfEdge[]>()

  const addHalfEdge = (from: Point, to: Point, wall: Wall) => {
    const fromKey = vertexKey(from)
    const toKey = vertexKey(to)
    if (fromKey === toKey) return
    points.set(fromKey, from)
    points.set(toKey, to)
    const edge: HalfEdge = {
      from: fromKey,
      to: toKey,
      angle: Math.atan2(to.y - from.y, to.x - from.x),
      wall,
    }
    const list = outgoing.get(fromKey)
    if (list) list.push(edge)
    else outgoing.set(fromKey, [edge])
  }

  for (const segment of segments) {
    addHalfEdge(segment.a, segment.b, segment.wall)
    addHalfEdge(segment.b, segment.a, segment.wall)
  }

  // Sorter utgående kanter mot klokka rundt hvert knutepunkt.
  for (const list of outgoing.values()) {
    list.sort((left, right) => left.angle - right.angle)
  }

  const edgeKey = (edge: HalfEdge) => `${edge.from}>${edge.to}`
  const visited = new Set<string>()
  const cycles: TracedCycle[] = []

  for (const list of outgoing.values()) {
    for (const start of list) {
      if (visited.has(edgeKey(start))) continue

      const cycle: HalfEdge[] = []
      let current = start
      let guard = 0

      while (guard++ < 10000) {
        visited.add(edgeKey(current))
        cycle.push(current)

        const candidates = outgoing.get(current.to)
        if (!candidates || candidates.length === 0) break

        const reverseIndex = candidates.findIndex((candidate) => candidate.to === current.from)
        if (reverseIndex === -1) break

        // Ett steg «bakover» i CCW-sorteringen = neste kant med klokka.
        const nextIndex = (reverseIndex - 1 + candidates.length) % candidates.length
        const next = candidates[nextIndex]

        if (edgeKey(next) === edgeKey(start)) break
        if (visited.has(edgeKey(next))) break
        current = next
      }

      if (cycle.length < 3) continue

      const outline = cycle.map((edge) => points.get(edge.from)!).filter(Boolean)
      if (outline.length < 3) continue

      cycles.push({ outline, cycle, signedArea: signedArea(outline) })
    }
  }

  return cycles
}

export function detectFaces(walls: Wall[]): DetectedFace[] {
  const faces: DetectedFace[] = []

  for (const traced of traceCycles(walls)) {
    // Negativt areal = ytre flate; ~0 = løkke rundt en blindvegg.
    if (traced.signedArea <= MIN_ROOM_AREA) continue

    const inner = insetFace(traced.outline, traced.cycle)
    const usable = inner.length >= 3 ? inner : traced.outline
    faces.push({
      outline: traced.outline,
      inner: usable,
      area: polygonArea(usable),
      wallIds: Array.from(new Set(traced.cycle.map((edge) => edge.wall.id))),
    })
  }

  return faces.sort((left, right) => right.area - left.area)
}

/**
 * Byggets ytterkontur: den ytre flaten i vegg-grafen, snudd til mot klokka.
 * Brukes til å legge inn gulv og tak «etter ytterveggene» med ett klikk.
 */
export function outerOutline(walls: Wall[]): Point[] | null {
  let best: TracedCycle | null = null
  for (const traced of traceCycles(walls)) {
    if (traced.signedArea >= 0) continue
    if (!best || traced.signedArea < best.signedArea) best = traced
  }
  if (!best) return null
  const reversed = [...best.outline].reverse()
  return polygonArea(reversed) > 0.5 ? reversed : null
}

/**
 * Trekker hver kant inn med halve tykkelsen til veggen kanten kom fra, og
 * finner de nye hjørnene som skjæringen mellom nabokantene.
 */
function insetFace(outline: Point[], cycle: HalfEdge[]): Point[] {
  if (outline.length !== cycle.length) return outline

  const lines = cycle.map((edge, index) => {
    const from = outline[index]
    const to = outline[(index + 1) % outline.length]
    const direction = normalize(sub(to, from))
    // Polygonet går mot klokka, så innover er venstre normal.
    const inward = { x: -direction.y, y: direction.x }
    const offset = edge.wall.thickness / 2
    return { origin: add(from, scale(inward, offset)), direction }
  })

  const result: Point[] = []
  for (let i = 0; i < lines.length; i++) {
    const previous = lines[(i - 1 + lines.length) % lines.length]
    const current = lines[i]
    const intersection = lineIntersection(
      previous.origin,
      previous.direction,
      current.origin,
      current.direction
    )
    result.push(intersection ?? current.origin)
  }

  // Innsettingen kan kollapse svært smale flater — behold da senterlinjene.
  if (polygonArea(result) < 0.1) return outline
  return result
}

/**
 * Oppdaterer romlista for en etasje. Rom brukeren har navngitt beholder navnet
 * sitt så lenge geometrien fortsatt overlapper — ellers ville hver veggflytting
 * slettet «Bad» og «Stue».
 */
export function syncSpaces(walls: Wall[], existing: Space[]): Space[] {
  const faces = detectFaces(walls)
  const manual = existing.filter((space) => !space.autoGenerated)
  const named = existing.filter((space) => space.autoGenerated)
  const used = new Set<string>()

  const spaces: Space[] = faces.map((face, index) => {
    const centroid = face.inner.reduce((acc, point) => add(acc, point), { x: 0, y: 0 })
    const center = scale(centroid, 1 / Math.max(face.inner.length, 1))

    // Gjenbruk navnet fra det tidligere rommet med nærmeste tyngdepunkt.
    let bestMatch: Space | null = null
    let bestDistance = Infinity
    for (const candidate of named) {
      if (used.has(candidate.id)) continue
      const candidateCentroid = candidate.outline.reduce((acc, point) => add(acc, point), {
        x: 0,
        y: 0,
      })
      const candidateCenter = scale(candidateCentroid, 1 / Math.max(candidate.outline.length, 1))
      const dist = distance(center, candidateCenter)
      if (dist < bestDistance && dist < 3) {
        bestDistance = dist
        bestMatch = candidate
      }
    }
    if (bestMatch) used.add(bestMatch.id)

    return {
      id: bestMatch?.id ?? newId("sp"),
      name: bestMatch?.name ?? `Rom ${index + 1}`,
      outline: face.inner,
      autoGenerated: true,
      floorMaterialId: bestMatch?.floorMaterialId ?? null,
      wallMaterialId: bestMatch?.wallMaterialId ?? null,
      ceilingMaterialId: bestMatch?.ceilingMaterialId ?? null,
    }
  })

  return [...spaces, ...manual]
}
