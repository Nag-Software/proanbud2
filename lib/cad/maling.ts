/**
 * Måling i 3D: snapping til hjørner og kanter, og tall slik en håndverker
 * leser dem (millimeter, som på tegningen).
 *
 * Ren matematikk uten three, så det kan testes. Vektorer er three-koordinater
 * ([x, høyde, −plan y]); `Point3` er planets (x øst, y nord, z opp).
 */

import type { Point3 } from "./types"

export type V3 = [number, number, number]

export function tilPlanPunkt(v: V3): Point3 {
  return { x: v[0], y: -v[2], z: v[1] }
}

export function fraPlanPunkt(p: Point3): V3 {
  return [p.x, p.z, -p.y]
}

/** «4 820» — hele millimeter med tusenskille, som på arbeidstegninger. */
export function formatMm(meter: number): string {
  return Math.round(meter * 1000).toLocaleString("nb-NO")
}

/** Total lengde, og hvor mye av den som er vannrett og loddrett. */
export function maleDeler(a: Point3, b: Point3) {
  const horisontalt = Math.hypot(b.x - a.x, b.y - a.y)
  const hoyde = Math.abs(b.z - a.z)
  return { total: Math.hypot(horisontalt, hoyde), horisontalt, hoyde }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: V3) => Math.sqrt(dot(a, a))

/** Nærmeste punkt på linjestykket a–b. */
export function naermestePaKant(p: V3, a: V3, b: V3): V3 {
  const ab = sub(b, a)
  const l2 = dot(ab, ab)
  const t = l2 > 0 ? Math.min(Math.max(dot(sub(p, a), ab) / l2, 0), 1) : 0
  return [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]
}

/**
 * Er kant nr. `kant` (0 = a–b, 1 = b–c, 2 = c–a) diagonalen i et rektangel som
 * er delt i to trekanter? Den er lengst, og vinkelen rett overfor er 90°.
 * Den kanten finnes ikke på bygget, så den skal man ikke snappe til.
 */
export function erDiagonal(hjorner: [V3, V3, V3], kant: number): boolean {
  const lengder = [0, 1, 2].map((i) => len(sub(hjorner[(i + 1) % 3], hjorner[i])))
  const lengst = lengder.indexOf(Math.max(...lengder))
  if (lengst !== kant) return false
  const motstaende = hjorner[(kant + 2) % 3]
  const u = sub(hjorner[kant], motstaende)
  const v = sub(hjorner[(kant + 1) % 3], motstaende)
  const nevner = len(u) * len(v)
  return nevner > 0 && Math.abs(dot(u, v) / nevner) < 0.02
}

export type Snapp = { punkt: V3; type: "hjorne" | "kant" | "flate" }

/**
 * Flytter et treffpunkt til nærmeste hjørne, ellers nærmeste kant, når det
 * ligger innenfor `grense` skjermpiksler. Hjørner vinner: det er der man måler
 * fra («fra hjørnet av veggen til …»).
 */
export function snappTilTrekant(
  treff: V3,
  hjorner: [V3, V3, V3],
  tilSkjerm: (v: V3) => [number, number],
  grense: number
): Snapp {
  const [tx, ty] = tilSkjerm(treff)
  const avstand = (v: V3) => {
    const [x, y] = tilSkjerm(v)
    return Math.hypot(x - tx, y - ty)
  }

  let beste: V3 | null = null
  let besteAvstand = grense
  for (const hjorne of hjorner) {
    const d = avstand(hjorne)
    if (d <= besteAvstand) {
      besteAvstand = d
      beste = hjorne
    }
  }
  if (beste) return { punkt: [...beste] as V3, type: "hjorne" }

  for (let kant = 0; kant < 3; kant++) {
    if (erDiagonal(hjorner, kant)) continue
    const punkt = naermestePaKant(treff, hjorner[kant], hjorner[(kant + 1) % 3])
    const d = avstand(punkt)
    if (d <= besteAvstand) {
      besteAvstand = d
      beste = punkt
    }
  }
  if (beste) return { punkt: beste, type: "kant" }
  return { punkt: [...treff] as V3, type: "flate" }
}
