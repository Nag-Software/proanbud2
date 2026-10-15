import { describe, expect, it } from "vitest"

import {
  erDiagonal,
  formatMm,
  fraPlanPunkt,
  maleDeler,
  snappTilTrekant,
  tilPlanPunkt,
  type V3,
} from "../../lib/cad/maling"

// Rett ovenfra: skjermpiksler = meter × 100, z nedover på skjermen.
const ovenfra = (v: V3): [number, number] => [v[0] * 100, v[2] * 100]

describe("måling", () => {
  it("planpunkt ↔ three-koordinater", () => {
    const p = { x: 2, y: 5, z: 1.2 }
    expect(fraPlanPunkt(p)).toEqual([2, 1.2, -5])
    expect(tilPlanPunkt(fraPlanPunkt(p))).toEqual(p)
  })

  it("deler opp i vannrett og høyde, og skriver millimeter", () => {
    const deler = maleDeler({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 2.4 })
    expect(deler.horisontalt).toBeCloseTo(5)
    expect(deler.hoyde).toBeCloseTo(2.4)
    expect(formatMm(deler.horisontalt)).toBe((5000).toLocaleString("nb-NO"))
    expect(formatMm(0.0004)).toBe("0")
  })

  it("diagonalen i et rektangel er ikke en kant", () => {
    const t: [V3, V3, V3] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 3],
    ]
    expect(erDiagonal(t, 2)).toBe(true) // (4,0,3) → (0,0,0)
    expect(erDiagonal(t, 0)).toBe(false)
    const skjev: [V3, V3, V3] = [
      [0, 0, 0],
      [4, 0, 0],
      [1, 0, 3],
    ]
    expect(erDiagonal(skjev, 0)).toBe(false)
  })

  it("snapper til hjørne før kant, og aldri til diagonalen", () => {
    const t: [V3, V3, V3] = [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 3],
    ]
    expect(snappTilTrekant([3.95, 0, 0.05], t, ovenfra, 12)).toEqual({ punkt: [4, 0, 0], type: "hjorne" })
    const kant = snappTilTrekant([2, 0, 0.06], t, ovenfra, 12)
    expect(kant.type).toBe("kant")
    expect(kant.punkt[2]).toBeCloseTo(0)
    // Nær diagonalen, langt fra hjørner og ekte kanter: blir stående.
    expect(snappTilTrekant([2, 0, 1.55], t, ovenfra, 12).type).toBe("flate")
  })
})
