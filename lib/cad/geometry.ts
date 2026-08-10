/**
 * Geometrikjernen: fra parametrisk modell til byggbare volumer.
 *
 * Ansvar:
 *   1. Fotavtrykk med GJÆREDE hjørner, slik at to vegger som møtes gir et tett
 *      hjørne i stedet for et hakk eller en overlapp (den vanligste grunnen til
 *      at hjemmesnekrede 3D-plantegninger ser billige ut).
 *   2. Oppdeling av vegger i delstykker rundt dører og vinduer — ekte hull,
 *      ikke teksturerte firkanter.
 *   3. Volumer (ElementSolid) som både 3D-visningen, IFC-eksporten og
 *      utvelgelsen bruker. Én sannhet — 3D-bildet og eksportfila kan ikke
 *      komme i utakt.
 *
 * Koordinater: modellen er plan (x, y) + høyde. Mesh-posisjoner skrives i
 * three.js-konvensjon (Y opp): [x, høyde, -y]. Profiler til IFC beholdes i
 * plan-koordinater, som er det IFC selv bruker (X øst, Y nord, Z opp).
 */

import {
  add,
  closestPointOnSegment,
  cross,
  distance,
  degToRad,
  dot,
  lerp,
  lineIntersection,
  normalize,
  perpendicular,
  polygonArea,
  scale,
  signedArea,
  sub,
  triangulatePolygon,
} from "./math"
import type {
  BuildingModel,
  Column,
  ElementSolid,
  Point,
  Roof,
  Slab,
  SolidMesh,
  Storey,
  Wall,
  WallFootprint,
  WallPart,
} from "./types"

/** Punkter regnes som samme knutepunkt under denne avstanden (5 mm). */
const JOINT_TOLERANCE = 0.005

// ---------------------------------------------------------------------------
// Koordinatkonvertering
// ---------------------------------------------------------------------------

export function worldFromPlan(point: Point, height: number): [number, number, number] {
  return [point.x, height, -point.y]
}

export function planFromWorld(x: number, y: number, z: number) {
  return { point: { x, y: -z }, height: y }
}

// ---------------------------------------------------------------------------
// Veggfotavtrykk med gjæring
// ---------------------------------------------------------------------------

function jointKey(point: Point) {
  return `${Math.round(point.x / JOINT_TOLERANCE)}:${Math.round(point.y / JOINT_TOLERANCE)}`
}

type WallEnd = { wall: Wall; end: "a" | "b" }

type SideLines = {
  left: { origin: Point; direction: Point }
  right: { origin: Point; direction: Point }
  direction: Point
  normal: Point
  length: number
}

function sideLines(wall: Wall): SideLines {
  const direction = normalize(sub(wall.b, wall.a))
  const normal = perpendicular(direction)
  const half = wall.thickness / 2
  return {
    left: { origin: add(wall.a, scale(normal, half)), direction },
    right: { origin: add(wall.a, scale(normal, -half)), direction },
    direction,
    normal,
    length: distance(wall.a, wall.b),
  }
}

/**
 * Finner ut hvilken side av naboveggen som hører sammen med vår venstre side.
 *
 * «Nærmeste skjæring» duger ikke: i et rett hjørne ligger begge nabosidene
 * nøyaktig like langt unna knutepunktet, og valget blir en myntkast som gir et
 * innoverbrettet hjørne. I stedet leser vi de to veggene som ÉN gjennomgående
 * strek: vi går INN i knutepunktet langs den ene og UT langs den andre.
 * «Venstre» er da entydig hele veien, og sidene parer seg av seg selv.
 */
function sidesArePaired(ownEnd: "a" | "b", neighbourEnd: "a" | "b") {
  const inbound = ownEnd === "b" ? 1 : -1
  const outbound = neighbourEnd === "a" ? 1 : -1
  return inbound * outbound > 0
}

function miterPoint(
  own: { origin: Point; direction: Point },
  neighbourLine: { origin: Point; direction: Point },
  joint: Point,
  maxDistance: number
): Point | null {
  const intersection = lineIntersection(
    own.origin,
    own.direction,
    neighbourLine.origin,
    neighbourLine.direction
  )
  if (!intersection) return null
  if (distance(intersection, joint) > maxDistance) return null
  return intersection
}

export function computeWallFootprints(walls: Wall[]): Map<string, WallFootprint> {
  const joints = new Map<string, WallEnd[]>()
  const lines = new Map<string, SideLines>()

  for (const wall of walls) {
    lines.set(wall.id, sideLines(wall))
    for (const end of ["a", "b"] as const) {
      const key = jointKey(end === "a" ? wall.a : wall.b)
      const existing = joints.get(key)
      if (existing) existing.push({ wall, end })
      else joints.set(key, [{ wall, end }])
    }
  }

  /**
   * Vegger som passerer gjennom punktet UTEN å ha et endepunkt der — altså et
   * T-kryss midt på en vegg. Uten dette får skilleveggen en synlig glipe mot
   * den gjennomgående veggen.
   */
  const wallsThrough = (point: Point, exceptId: string) =>
    walls.filter((candidate) => {
      if (candidate.id === exceptId) return false
      const projection = closestPointOnSegment(point, candidate.a, candidate.b)
      if (projection.distance > JOINT_TOLERANCE) return false
      const along = projection.t * distance(candidate.a, candidate.b)
      const fromEnd = distance(candidate.a, candidate.b) - along
      return along > JOINT_TOLERANCE && fromEnd > JOINT_TOLERANCE
    })

  const footprints = new Map<string, WallFootprint>()

  for (const wall of walls) {
    const own = lines.get(wall.id)!
    const half = wall.thickness / 2

    // Startverdier: rette (ugjærede) endeflater.
    let leftStart = own.left.origin
    let rightStart = own.right.origin
    let leftEnd = add(own.left.origin, scale(own.direction, own.length))
    let rightEnd = add(own.right.origin, scale(own.direction, own.length))

    for (const end of ["a", "b"] as const) {
      const joint = end === "a" ? wall.a : wall.b
      const endpointNeighbours = (joints.get(jointKey(joint)) || []).filter(
        (candidate) => candidate.wall.id !== wall.id
      )
      const throughNeighbours = wallsThrough(joint, wall.id)

      if (endpointNeighbours.length === 0 && throughNeighbours.length === 0) continue

      if (endpointNeighbours.length === 1 && throughNeighbours.length === 0) {
        const neighbour = endpointNeighbours[0]
        const neighbourLines = lines.get(neighbour.wall.id)!
        const maxThickness = Math.max(wall.thickness, neighbour.wall.thickness)
        // Ved svært skarpe vinkler stikker gjæringen langt ut. Vi tillater
        // maks 6× tykkelsen, ellers ser hjørnet ut som en pil.
        const maxDistance = maxThickness * 6

        const paired = sidesArePaired(end, neighbour.end)
        const leftMiter = miterPoint(
          own.left,
          paired ? neighbourLines.left : neighbourLines.right,
          joint,
          maxDistance
        )
        const rightMiter = miterPoint(
          own.right,
          paired ? neighbourLines.right : neighbourLines.left,
          joint,
          maxDistance
        )

        if (leftMiter && rightMiter) {
          if (end === "a") {
            leftStart = leftMiter
            rightStart = rightMiter
          } else {
            leftEnd = leftMiter
            rightEnd = rightMiter
          }
        }
        // Parallelle vegger (rett skjøt) — la enden stå rett.
        continue
      }

      // T- eller X-kryss: gjæring er ikke entydig. Forleng inn i den tykkeste
      // naboen så det ikke blir en synlig glipe i hjørnet.
      const extension = Math.max(
        ...endpointNeighbours.map((candidate) => candidate.wall.thickness / 2),
        ...throughNeighbours.map((candidate) => candidate.thickness / 2),
        half
      )
      const push = scale(own.direction, end === "a" ? -extension : extension)
      if (end === "a") {
        leftStart = add(leftStart, push)
        rightStart = add(rightStart, push)
      } else {
        leftEnd = add(leftEnd, push)
        rightEnd = add(rightEnd, push)
      }
    }

    const startMid = scale(add(leftStart, rightStart), 0.5)
    const endMid = scale(add(leftEnd, rightEnd), 0.5)
    const uStart = dot(sub(startMid, wall.a), own.direction)
    const uEnd = dot(sub(endMid, wall.a), own.direction)

    footprints.set(wall.id, {
      wallId: wall.id,
      left: [leftStart, leftEnd],
      right: [rightStart, rightEnd],
      uStart,
      uEnd: uEnd > uStart + 1e-6 ? uEnd : uStart + own.length,
      length: own.length,
      direction: own.direction,
      normal: own.normal,
    })
  }

  return footprints
}

/** Fotavtrykkets ytre polygon (til plantegning og arealberegning). */
export function footprintPolygon(footprint: WallFootprint): Point[] {
  return [footprint.left[0], footprint.left[1], footprint.right[1], footprint.right[0]]
}

/** Firkanten som dekker parameterområdet [t0, t1] av fotavtrykket. */
export function footprintQuad(
  footprint: WallFootprint,
  t0: number,
  t1: number
): [Point, Point, Point, Point] {
  const l0 = lerp(footprint.left[0], footprint.left[1], t0)
  const l1 = lerp(footprint.left[0], footprint.left[1], t1)
  const r0 = lerp(footprint.right[0], footprint.right[1], t0)
  const r1 = lerp(footprint.right[0], footprint.right[1], t1)
  return [l0, l1, r1, r0]
}

// ---------------------------------------------------------------------------
// Veggoppdeling rundt åpninger
// ---------------------------------------------------------------------------

/**
 * Deler veggen i rektangulære stykker slik at dører og vinduer blir ekte hull:
 * hele stykker mellom åpninger, brystning under vinduer og losholt over.
 */
export function computeWallParts(wall: Wall, footprint: WallFootprint): WallPart[] {
  const span = footprint.uEnd - footprint.uStart
  if (span <= 1e-6) return []

  const toT = (u: number) => (u - footprint.uStart) / span
  const parts: WallPart[] = []
  const height = wall.height

  let cursor = footprint.uStart

  const sorted = [...wall.openings].sort((left, right) => left.distance - right.distance)

  for (const opening of sorted) {
    const openingStart = Math.max(opening.distance - opening.width / 2, cursor)
    const openingEnd = Math.min(opening.distance + opening.width / 2, footprint.uEnd)
    if (openingEnd <= openingStart + 1e-6) continue

    if (openingStart > cursor + 1e-6) {
      parts.push({ t0: toT(cursor), t1: toT(openingStart), y0: 0, y1: height, role: "between" })
    }

    const sill = Math.max(opening.sill, 0)
    const head = Math.min(sill + opening.height, height)

    if (sill > 1e-6) {
      parts.push({ t0: toT(openingStart), t1: toT(openingEnd), y0: 0, y1: sill, role: "under" })
    }
    if (head < height - 1e-6) {
      parts.push({ t0: toT(openingStart), t1: toT(openingEnd), y0: head, y1: height, role: "over" })
    }

    cursor = openingEnd
  }

  if (cursor < footprint.uEnd - 1e-6) {
    parts.push({ t0: toT(cursor), t1: toT(footprint.uEnd), y0: 0, y1: height, role: sorted.length === 0 ? "full" : "between" })
  }

  return parts
}

// ---------------------------------------------------------------------------
// Mesh-byggere
// ---------------------------------------------------------------------------

function emptyMesh(): SolidMesh {
  return { positions: [], indices: [] }
}

function appendMesh(target: SolidMesh, source: SolidMesh) {
  const offset = target.positions.length / 3
  target.positions.push(...source.positions)
  for (const index of source.indices) target.indices.push(index + offset)
}

/**
 * Vertikal prisme fra et plan-polygon. Polygonet snus til mot klokka slik at
 * topplokket peker opp og sideflatene får riktig normalretning.
 */
export function prismMesh(profile: Point[], z0: number, z1: number): SolidMesh {
  if (profile.length < 3) return emptyMesh()

  const outline = signedArea(profile) < 0 ? [...profile].reverse() : profile
  const count = outline.length
  const positions: number[] = []
  const indices: number[] = []

  for (const point of outline) positions.push(...worldFromPlan(point, z1)) // topp: 0..n-1
  for (const point of outline) positions.push(...worldFromPlan(point, z0)) // bunn: n..2n-1

  const cap = triangulatePolygon(outline)
  for (let i = 0; i < cap.length; i += 3) {
    // Topp beholder rekkefølgen (normal opp), bunn snus (normal ned).
    indices.push(cap[i], cap[i + 1], cap[i + 2])
    indices.push(count + cap[i + 2], count + cap[i + 1], count + cap[i])
  }

  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    const topA = i
    const topB = next
    const bottomA = count + i
    const bottomB = count + next
    indices.push(topA, bottomA, bottomB)
    indices.push(topA, bottomB, topB)
  }

  return { positions, indices }
}

/**
 * Prisme der hvert hjørne har sin egen topphøyde — grunnlaget for pult- og
 * saltak. Bunnflaten følger toppen forskjøvet loddrett ned.
 */
function slopedPrismMesh(
  profile: Point[],
  topHeights: number[],
  verticalThickness: number
): SolidMesh {
  if (profile.length < 3) return emptyMesh()

  const isCcw = signedArea(profile) > 0
  const outline = isCcw ? profile : [...profile].reverse()
  const heights = isCcw ? topHeights : [...topHeights].reverse()
  const count = outline.length
  const positions: number[] = []
  const indices: number[] = []

  for (let i = 0; i < count; i++) positions.push(...worldFromPlan(outline[i], heights[i]))
  for (let i = 0; i < count; i++) {
    positions.push(...worldFromPlan(outline[i], heights[i] - verticalThickness))
  }

  const cap = triangulatePolygon(outline)
  for (let i = 0; i < cap.length; i += 3) {
    indices.push(cap[i], cap[i + 1], cap[i + 2])
    indices.push(count + cap[i + 2], count + cap[i + 1], count + cap[i])
  }

  for (let i = 0; i < count; i++) {
    const next = (i + 1) % count
    indices.push(i, count + i, count + next)
    indices.push(i, count + next, next)
  }

  return { positions, indices }
}

export function boxMesh(
  center: Point,
  width: number,
  depth: number,
  rotationDeg: number,
  z0: number,
  z1: number
): SolidMesh {
  const angle = degToRad(rotationDeg)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const halfWidth = width / 2
  const halfDepth = depth / 2

  const corners: Point[] = [
    { x: -halfWidth, y: -halfDepth },
    { x: halfWidth, y: -halfDepth },
    { x: halfWidth, y: halfDepth },
    { x: -halfWidth, y: halfDepth },
  ].map((corner) => ({
    x: center.x + corner.x * cos - corner.y * sin,
    y: center.y + corner.x * sin + corner.y * cos,
  }))

  return prismMesh(corners, z0, z1)
}

// ---------------------------------------------------------------------------
// Takhøydefunksjon
// ---------------------------------------------------------------------------

/**
 * Høyden på taket i et gitt punkt.
 *  - flat: konstant
 *  - pult: lineært fall langs `directionDeg`
 *  - sal: mønet ligger langs `directionDeg` gjennom omrissets senter,
 *         høyden faller symmetrisk ut til begge sider
 */
export function roofHeightAt(roof: Roof, point: Point, outline: Point[], center: Point) {
  if (roof.kind === "flat" || roof.pitchDeg <= 0) return roof.baseHeight

  const slope = Math.tan(degToRad(roof.pitchDeg))
  const direction = { x: Math.cos(degToRad(roof.directionDeg)), y: Math.sin(degToRad(roof.directionDeg)) }

  if (roof.kind === "mono") {
    const projections = outline.map((corner) => dot(sub(corner, center), direction))
    const min = Math.min(...projections)
    return roof.baseHeight + (dot(sub(point, center), direction) - min) * slope
  }

  // Saltak: avstand fra mønelinja måles langs normalen til møneretningen.
  const normal = perpendicular(direction)
  const spans = outline.map((corner) => Math.abs(dot(sub(corner, center), normal)))
  const halfSpan = Math.max(...spans, 0)
  const offsetFromRidge = Math.abs(dot(sub(point, center), normal))
  return roof.baseHeight + (halfSpan - offsetFromRidge) * slope
}

export function roofMesh(roof: Roof, storeyElevation: number, outline: Point[]): SolidMesh {
  if (outline.length < 3) return emptyMesh()

  // Spennvidden måles alltid mot BYGGETS omriss, ikke mot utstikket. `baseHeight`
  // er da raftehøyden ved veggen — slik en håndverker leser den — og utstikket
  // fortsetter takflaten videre nedover utenfor veggen, som i virkeligheten.
  const spanOutline = roof.outline.length >= 3 ? roof.outline : outline
  const center = spanOutline.reduce((acc, point) => add(acc, point), { x: 0, y: 0 })
  const centroid = scale(center, 1 / spanOutline.length)
  const pitchRad = degToRad(roof.kind === "flat" ? 0 : roof.pitchDeg)
  // Deklarert tykkelse er vinkelrett på takflaten; loddrett tykkelse blir da
  // t / cos(vinkel), slik at et 30°-tak faktisk får 30 cm konstruksjon.
  const verticalThickness = roof.thickness / Math.max(Math.cos(pitchRad), 0.2)

  if (roof.kind === "gable" && roof.pitchDeg > 0) {
    return gableRoofMesh(roof, outline, spanOutline, centroid, storeyElevation, verticalThickness)
  }

  const heights = outline.map(
    (point) => storeyElevation + roofHeightAt(roof, point, spanOutline, centroid)
  )
  return slopedPrismMesh(outline, heights, verticalThickness)
}

/**
 * Saltak må ha selve mønelinja som geometri, ellers får vi bare et skjevt plan.
 * Vi deler omrisset i to halvdeler langs mønet og setter inn mønepunktene der
 * omrisset krysser linja.
 */
function gableRoofMesh(
  roof: Roof,
  outline: Point[],
  spanOutline: Point[],
  centroid: Point,
  storeyElevation: number,
  verticalThickness: number
): SolidMesh {
  const direction = { x: Math.cos(degToRad(roof.directionDeg)), y: Math.sin(degToRad(roof.directionDeg)) }
  const normal = perpendicular(direction)
  const side = (point: Point) => dot(sub(point, centroid), normal)

  const positive: Point[] = []
  const negative: Point[] = []

  for (let i = 0; i < outline.length; i++) {
    const current = outline[i]
    const next = outline[(i + 1) % outline.length]
    const sideCurrent = side(current)
    const sideNext = side(next)

    if (sideCurrent >= 0) positive.push(current)
    if (sideCurrent <= 0) negative.push(current)

    if ((sideCurrent > 0 && sideNext < 0) || (sideCurrent < 0 && sideNext > 0)) {
      const t = sideCurrent / (sideCurrent - sideNext)
      const crossing = lerp(current, next, t)
      positive.push(crossing)
      negative.push(crossing)
    }
  }

  const mesh = emptyMesh()
  for (const half of [positive, negative]) {
    if (half.length < 3) continue
    const heights = half.map(
      (point) => storeyElevation + roofHeightAt(roof, point, spanOutline, centroid)
    )
    appendMesh(mesh, slopedPrismMesh(half, heights, verticalThickness))
  }

  // Degenerert omriss (alt på én side av mønet) — fall tilbake på pultform.
  if (mesh.positions.length === 0) {
    const heights = outline.map(
      (point) => storeyElevation + roofHeightAt(roof, point, spanOutline, centroid)
    )
    return slopedPrismMesh(outline, heights, verticalThickness)
  }

  return mesh
}

// ---------------------------------------------------------------------------
// Volumer for hele modellen
// ---------------------------------------------------------------------------

function wallSolids(
  wall: Wall,
  footprint: WallFootprint,
  storey: Storey
): ElementSolid[] {
  const parts = computeWallParts(wall, footprint)
  const base = storey.elevation + wall.baseOffset
  const solids: ElementSolid[] = []

  parts.forEach((part, index) => {
    const quad = footprintQuad(footprint, part.t0, part.t1)
    const z0 = base + part.y0
    const z1 = base + part.y1
    if (z1 - z0 < 1e-4) return

    solids.push({
      id: `${wall.id}#${index}`,
      elementId: wall.id,
      elementKind: "wall",
      storeyId: storey.id,
      materialId: wall.materialId ?? null,
      mesh: prismMesh(quad, z0, z1),
      extrusion: { profile: quad, z0, z1 },
    })
  })

  return solids
}

function openingSolids(wall: Wall, footprint: WallFootprint, storey: Storey): ElementSolid[] {
  const span = footprint.uEnd - footprint.uStart
  if (span <= 1e-6) return []
  const base = storey.elevation + wall.baseOffset

  return wall.openings.map((opening) => {
    const t0 = (opening.distance - opening.width / 2 - footprint.uStart) / span
    const t1 = (opening.distance + opening.width / 2 - footprint.uStart) / span
    const quad = footprintQuad(footprint, t0, t1)
    const z0 = base + opening.sill
    const z1 = z0 + opening.height

    return {
      id: `${opening.id}#fill`,
      elementId: opening.id,
      elementKind: "opening" as const,
      storeyId: storey.id,
      materialId: opening.materialId ?? null,
      mesh: prismMesh(quad, z0, z1),
      extrusion: { profile: quad, z0, z1 },
    }
  })
}

function slabSolid(slab: Slab, storey: Storey): ElementSolid | null {
  if (slab.outline.length < 3) return null
  const top = storey.elevation + slab.offset
  const z0 = top - slab.thickness
  return {
    id: slab.id,
    elementId: slab.id,
    elementKind: "slab",
    storeyId: storey.id,
    materialId: slab.materialId ?? null,
    mesh: prismMesh(slab.outline, z0, top),
    extrusion: { profile: slab.outline, z0, z1: top },
  }
}

function columnSolid(column: Column, storey: Storey): ElementSolid {
  const z0 = storey.elevation + column.baseOffset
  const z1 = z0 + column.height
  return {
    id: column.id,
    elementId: column.id,
    elementKind: "column",
    storeyId: storey.id,
    materialId: column.materialId ?? null,
    mesh: boxMesh(column.position, column.width, column.depth, column.rotationDeg, z0, z1),
  }
}

export type StoreySolids = {
  storeyId: string
  footprints: Map<string, WallFootprint>
  solids: ElementSolid[]
}

export function buildStoreySolids(storey: Storey): StoreySolids {
  const footprints = computeWallFootprints(storey.walls)
  const solids: ElementSolid[] = []

  for (const wall of storey.walls) {
    const footprint = footprints.get(wall.id)
    if (!footprint) continue
    solids.push(...wallSolids(wall, footprint, storey))
    solids.push(...openingSolids(wall, footprint, storey))
  }

  for (const slab of storey.slabs) {
    const solid = slabSolid(slab, storey)
    if (solid) solids.push(solid)
  }

  for (const column of storey.columns) {
    solids.push(columnSolid(column, storey))
  }

  for (const roof of storey.roofs) {
    const outline = roof.overhang > 0 ? expandOutline(roof.outline, roof.overhang) : roof.outline
    solids.push({
      id: roof.id,
      elementId: roof.id,
      elementKind: "roof",
      storeyId: storey.id,
      materialId: roof.materialId ?? null,
      mesh: roofMesh(roof, storey.elevation, outline),
    })
  }

  return { storeyId: storey.id, footprints, solids }
}

export function buildModelSolids(model: BuildingModel) {
  return model.storeys.map((storey) => buildStoreySolids(storey))
}

// ---------------------------------------------------------------------------
// Hjelpere
// ---------------------------------------------------------------------------

/** Utvider et polygon utover langs normalene (brukes til takutstikk). */
export function expandOutline(points: Point[], amount: number): Point[] {
  if (points.length < 3 || amount === 0) return points
  const ccw = signedArea(points) < 0 ? [...points].reverse() : points
  const result: Point[] = []

  for (let i = 0; i < ccw.length; i++) {
    const previous = ccw[(i - 1 + ccw.length) % ccw.length]
    const current = ccw[i]
    const next = ccw[(i + 1) % ccw.length]

    const dirIn = normalize(sub(current, previous))
    const dirOut = normalize(sub(next, current))
    // Utover for et CCW-polygon er venstre normal speilvendt: (y, -x).
    const normalIn = { x: dirIn.y, y: -dirIn.x }
    const normalOut = { x: dirOut.y, y: -dirOut.x }

    const intersection = lineIntersection(
      add(previous, scale(normalIn, amount)),
      dirIn,
      add(current, scale(normalOut, amount)),
      dirOut
    )
    result.push(intersection ?? add(current, scale(normalOut, amount)))
  }

  return result
}

/** Veggens senterlinjelengde. */
export function wallLength(wall: Wall) {
  return distance(wall.a, wall.b)
}

/** Punktet på veggens senterlinje `distance` meter fra a. */
export function pointOnWall(wall: Wall, distanceFromStart: number): Point {
  const direction = normalize(sub(wall.b, wall.a))
  return add(wall.a, scale(direction, distanceFromStart))
}

/** Avstanden langs veggen (fra a) til punktet nærmest `point`. */
export function projectOntoWall(wall: Wall, point: Point) {
  const direction = normalize(sub(wall.b, wall.a))
  const along = dot(sub(point, wall.a), direction)
  return Math.max(0, Math.min(wallLength(wall), along))
}

/** Positiv når punktet ligger til venstre for veggretningen. */
export function sideOfWall(wall: Wall, point: Point) {
  return cross(sub(wall.b, wall.a), sub(point, wall.a))
}

export function modelBounds(model: BuildingModel) {
  const points: Point[] = []
  for (const storey of model.storeys) {
    for (const wall of storey.walls) points.push(wall.a, wall.b)
    for (const slab of storey.slabs) points.push(...slab.outline)
    for (const roof of storey.roofs) points.push(...roof.outline)
    for (const column of storey.columns) points.push(column.position)
  }
  if (points.length === 0) {
    return { minX: -5, minY: -5, maxX: 5, maxY: 5, width: 10, height: 10, center: { x: 0, y: 0 } }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  }
}

/** Samlet fotavtrykksareal (brutto grunnflate) for én etasje. */
export function storeyFootprintArea(storey: Storey) {
  const slabArea = storey.slabs
    .filter((slab) => slab.kind === "floor" || slab.kind === "foundation")
    .reduce((sum, slab) => sum + polygonArea(slab.outline), 0)
  if (slabArea > 0) return slabArea
  return storey.spaces.reduce((sum, space) => sum + polygonArea(space.outline), 0)
}
