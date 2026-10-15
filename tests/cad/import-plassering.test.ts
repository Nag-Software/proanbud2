import { describe, expect, it } from "vitest"

import {
  kalibrer,
  midtstillModell,
  midtstillTegning,
  modellFotavtrykk,
  modellTilVerden,
  planTilTegning,
  tegningTilPlan,
} from "../../lib/cad/import/plassering"
import type { ModelImport } from "../../lib/cad/types"

const imp = (patch: Partial<ModelImport> = {}): ModelImport => ({
  id: "i",
  name: "f",
  format: "dxf",
  kind: "drawing",
  storagePath: "c/p/importer/x.dxf",
  sizeBytes: 1,
  visible: true,
  opacity: 1,
  scale: 0.001,
  offset: { x: 0, y: 0 },
  rotationDeg: 0,
  elevation: 0,
  upAxis: "y",
  storeyId: null,
  page: 1,
  createdAt: "",
  ...patch,
})

describe("tegninger", () => {
  it("DXF i mm blir meter, PDF/bilde speiles (y ned)", () => {
    expect(tegningTilPlan(imp(), 5000, 3000, false)).toEqual({ x: 5, y: 3 })
    const p = tegningTilPlan(imp({ scale: 0.01 }), 100, 50, true)
    expect(p.x).toBeCloseTo(1)
    expect(p.y).toBeCloseTo(-0.5)
  })

  it("rotasjon og flytting, og planTilTegning går tilbake", () => {
    const e = imp({ rotationDeg: 90, offset: { x: 10, y: 0 } })
    const p = tegningTilPlan(e, 1000, 0, false)
    expect(p.x).toBeCloseTo(10)
    expect(p.y).toBeCloseTo(1)
    const t = planTilTegning(e, p, false)
    expect(t.u).toBeCloseTo(1000)
    expect(t.v).toBeCloseTo(0)
  })

  it("kalibrering: 4 m på tegningen som egentlig er 8 m dobler målestokken, første punkt står stille", () => {
    const e = imp({ offset: { x: 2, y: 3 } })
    const a = tegningTilPlan(e, 1000, 1000, false)
    const b = tegningTilPlan(e, 5000, 1000, false)
    const ny = kalibrer(e, a, b, 8, false)!
    expect(ny.scale).toBeCloseTo(0.002)
    const etter = { ...e, ...ny }
    const a2 = tegningTilPlan(etter, 1000, 1000, false)
    const b2 = tegningTilPlan(etter, 5000, 1000, false)
    expect(a2.x).toBeCloseTo(a.x)
    expect(a2.y).toBeCloseTo(a.y)
    expect(Math.hypot(b2.x - a2.x, b2.y - a2.y)).toBeCloseTo(8)
    expect(kalibrer(e, a, a, 8, false)).toBeNull()
  })

  it("midtstilling legger midten av tegningen på målet", () => {
    const e = imp()
    const offset = midtstillTegning(e, { minX: 0, minY: 0, maxX: 10000, maxY: 6000 }, false, { x: 4, y: 3 })
    const midt = tegningTilPlan({ ...e, offset }, 5000, 3000, false)
    expect(midt.x).toBeCloseTo(4)
    expect(midt.y).toBeCloseTo(3)
  })
})

describe("3D-modeller", () => {
  it("Z-opp snus til Y-opp, og enheten skaleres", () => {
    const e = imp({ kind: "model", format: "stl", upAxis: "z", scale: 0.001 })
    const p = modellTilVerden(e, [1000, 2000, 3000])
    expect(p[0]).toBeCloseTo(1)
    expect(p[1]).toBeCloseTo(3) // Z (3000 mm) er høyden
    expect(p[2]).toBeCloseTo(-2) // Y (nord) blir −z
  })

  it("midtstilling: midt på målet i planet, bunnen på bakken", () => {
    const e = imp({ kind: "model", format: "ifc", scale: 1 })
    const grenser = { min: [10, -1, -20] as [number, number, number], max: [18, 2, -14] as [number, number, number] }
    const plass = midtstillModell(e, grenser, { x: 4, y: 3 })
    const fot = modellFotavtrykk({ ...e, ...plass }, grenser)
    expect((fot.minX + fot.maxX) / 2).toBeCloseTo(4)
    expect((fot.minY + fot.maxY) / 2).toBeCloseTo(3)
    expect(plass.elevation).toBeCloseTo(1)
  })

  it("90° rotasjon dreier mot klokka sett ovenfra (som planet)", () => {
    const e = imp({ kind: "model", format: "ifc", scale: 1, rotationDeg: 90 })
    const p = modellTilVerden(e, [1, 0, 0])
    // Øst (x) dreies til nord: plan y = 1 → three z = −1.
    expect(p[0]).toBeCloseTo(0)
    expect(p[2]).toBeCloseTo(-1)
  })
})
