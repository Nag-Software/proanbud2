/**
 * Hvor en importert fil ligger i modellen. Ren matematikk, delt av
 * plantegningen, 3D-scenen og importpanelet — så 2D og 3D alltid er enige.
 *
 * Planet: x mot øst, y mot nord (meter). 3D (three): x = plan x, y = høyde,
 * z = −plan y (som worldFromPlan i geometry.ts).
 */

import type { ModelImport, Point } from "../types"

type Grenser2 = { minX: number; minY: number; maxX: number; maxY: number }
type Grenser3 = { min: [number, number, number]; max: [number, number, number] }

const rad = (grader: number) => (grader * Math.PI) / 180

// ---------------------------------------------------------------------------
// Tegninger (DXF, PDF, bilde)
// ---------------------------------------------------------------------------

/**
 * Tegningsenhet → planet. DXF har y opp; PDF og bilder har y ned (fra øvre
 * venstre hjørne), så de speiles.
 */
export function tegningTilPlan(entry: ModelImport, u: number, v: number, yNed: boolean): Point {
  const k = entry.scale
  const lx = u * k
  const ly = (yNed ? -v : v) * k
  const cos = Math.cos(rad(entry.rotationDeg))
  const sin = Math.sin(rad(entry.rotationDeg))
  return { x: entry.offset.x + lx * cos - ly * sin, y: entry.offset.y + lx * sin + ly * cos }
}

/** Planet → tegningsenhet (motsatt vei; brukes ved kalibrering). */
export function planTilTegning(entry: ModelImport, punkt: Point, yNed: boolean): { u: number; v: number } {
  const dx = punkt.x - entry.offset.x
  const dy = punkt.y - entry.offset.y
  const cos = Math.cos(rad(-entry.rotationDeg))
  const sin = Math.sin(rad(-entry.rotationDeg))
  const lx = (dx * cos - dy * sin) / entry.scale
  const ly = (dx * sin + dy * cos) / entry.scale
  return { u: lx, v: yNed ? -ly : ly }
}

/** SVG-transform fra tegningsenheter til planets meter (y opp). */
export function tegningSvgTransform(entry: ModelImport, yNed: boolean): string {
  return `translate(${entry.offset.x} ${entry.offset.y}) rotate(${entry.rotationDeg}) scale(${entry.scale} ${yNed ? -entry.scale : entry.scale})`
}

/** Tegningens ytre grenser i planet. */
export function tegningGrenserIPlan(entry: ModelImport, grenser: Grenser2, yNed: boolean): Grenser2 {
  const hjorner = [
    tegningTilPlan(entry, grenser.minX, grenser.minY, yNed),
    tegningTilPlan(entry, grenser.maxX, grenser.minY, yNed),
    tegningTilPlan(entry, grenser.maxX, grenser.maxY, yNed),
    tegningTilPlan(entry, grenser.minX, grenser.maxY, yNed),
  ]
  return {
    minX: Math.min(...hjorner.map((p) => p.x)),
    minY: Math.min(...hjorner.map((p) => p.y)),
    maxX: Math.max(...hjorner.map((p) => p.x)),
    maxY: Math.max(...hjorner.map((p) => p.y)),
  }
}

/**
 * Ny målestokk fra kalibrering: to punkter på tegningen (i planet, slik de
 * ligger nå) og den virkelige avstanden mellom dem. Det første punktet blir
 * liggende der det er.
 */
export function kalibrer(
  entry: ModelImport,
  a: Point,
  b: Point,
  virkeligAvstand: number,
  yNed: boolean
): Pick<ModelImport, "scale" | "offset"> | null {
  const malt = Math.hypot(b.x - a.x, b.y - a.y)
  if (!(malt > 1e-9) || !(virkeligAvstand > 0)) return null
  const scale = entry.scale * (virkeligAvstand / malt)
  const lokal = planTilTegning(entry, a, yNed)
  const flyttet = tegningTilPlan({ ...entry, scale, offset: { x: 0, y: 0 } }, lokal.u, lokal.v, yNed)
  return { scale, offset: { x: a.x - flyttet.x, y: a.y - flyttet.y } }
}

/** Legger tegningen med midten på `mal` i planet. */
export function midtstillTegning(entry: ModelImport, grenser: Grenser2, yNed: boolean, mal: Point): Point {
  const midt = tegningTilPlan(
    { ...entry, offset: { x: 0, y: 0 } },
    (grenser.minX + grenser.maxX) / 2,
    (grenser.minY + grenser.maxY) / 2,
    yNed
  )
  return { x: mal.x - midt.x, y: mal.y - midt.y }
}

// ---------------------------------------------------------------------------
// 3D-modeller
// ---------------------------------------------------------------------------

/**
 * Et punkt i fila → 3D (three-koordinater). Rekkefølge: rett opp-aksen (Z-opp
 * snus til Y-opp), skaler til meter, drei om loddlinjen, flytt.
 */
export function modellTilVerden(entry: ModelImport, p: [number, number, number]): [number, number, number] {
  let [x, y, z] = p
  if (entry.upAxis === "z") [y, z] = [z, -y]
  x *= entry.scale
  y *= entry.scale
  z *= entry.scale
  const cos = Math.cos(rad(entry.rotationDeg))
  const sin = Math.sin(rad(entry.rotationDeg))
  // Positiv rotasjon er mot klokka sett ovenfra, som i planet.
  const rx = x * cos + z * sin
  const rz = -x * sin + z * cos
  return [rx + entry.offset.x, y + entry.elevation, rz - entry.offset.y]
}

/** Modellens grenser i 3D etter plassering (åtte hjørner, så rotasjon blir riktig). */
export function modellGrenserIVerden(entry: ModelImport, grenser: Grenser3): Grenser3 {
  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  for (const x of [grenser.min[0], grenser.max[0]]) {
    for (const y of [grenser.min[1], grenser.max[1]]) {
      for (const z of [grenser.min[2], grenser.max[2]]) {
        const p = modellTilVerden(entry, [x, y, z])
        for (let i = 0; i < 3; i++) {
          if (p[i] < min[i]) min[i] = p[i]
          if (p[i] > max[i]) max[i] = p[i]
        }
      }
    }
  }
  return { min, max }
}

/** Fotavtrykket i planet (for den stiplede boksen i plantegningen). */
export function modellFotavtrykk(entry: ModelImport, grenser: Grenser3): Grenser2 {
  const { min, max } = modellGrenserIVerden(entry, grenser)
  return { minX: min[0], maxX: max[0], minY: -max[2], maxY: -min[2] }
}

/**
 * Plasserer modellen med midten på `mal` i planet og bunnen på bakken (eller
 * etasjens gulv). Kalles ved import og fra «Midtstill».
 */
export function midtstillModell(
  entry: ModelImport,
  grenser: Grenser3,
  mal: Point,
  bakke = 0
): Pick<ModelImport, "offset" | "elevation"> {
  const uten = { ...entry, offset: { x: 0, y: 0 }, elevation: 0 }
  const { min, max } = modellGrenserIVerden(uten, grenser)
  const midtX = (min[0] + max[0]) / 2
  const midtPlanY = -(min[2] + max[2]) / 2
  return { offset: { x: mal.x - midtX, y: mal.y - midtPlanY }, elevation: bakke - min[1] }
}
