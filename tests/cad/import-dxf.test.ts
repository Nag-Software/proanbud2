import { describe, expect, it } from "vitest"

import { exportModelToDxf } from "../../lib/cad/export/dxf"
import { DxfFeil, lesDxf } from "../../lib/cad/import/dxf"
import { createEmptyModel } from "../../lib/cad/schema"
import { CadStore } from "../../lib/cad/store"

/** Lager DXF-tekst av (kode, verdi)-par. */
const dxf = (...par: Array<[number, string | number]>) => par.map(([k, v]) => `${k}\n${v}`).join("\n") + "\n"

const seksjon = (navn: string, ...innhold: Array<[number, string | number]>) =>
  [[0, "SECTION"], [2, navn], ...innhold, [0, "ENDSEC"]] as Array<[number, string | number]>

describe("lesDxf", () => {
  it("leser linjer, enhet og grenser", () => {
    const tekst = dxf(
      ...seksjon("HEADER", [9, "$INSUNITS"], [70, 4]),
      ...seksjon("ENTITIES", [0, "LINE"], [8, "VEGG"], [10, 0], [20, 0], [11, 5000], [21, 0]),
      [0, "EOF"]
    )
    const t = lesDxf(tekst)
    expect(t.antallSegmenter).toBe(1)
    expect(Array.from(t.segmenter)).toEqual([0, 0, 5000, 0])
    expect(t.enhetSkala).toBe(0.001)
    expect(t.grenser).toEqual({ minX: 0, minY: 0, maxX: 5000, maxY: 0 })
    expect(t.lag).toEqual(["VEGG"])
  })

  it("lukket polylinje, gammel POLYLINE/VERTEX og bue", () => {
    const tekst = dxf(
      ...seksjon(
        "ENTITIES",
        [0, "LWPOLYLINE"], [90, 4], [70, 1], [10, 0], [20, 0], [10, 4], [20, 0], [10, 4], [20, 3], [10, 0], [20, 3],
        [0, "POLYLINE"], [70, 0],
        [0, "VERTEX"], [10, 10], [20, 10],
        [0, "VERTEX"], [10, 12], [20, 10],
        [0, "SEQEND"],
        [0, "ARC"], [10, 0], [20, 0], [40, 1], [50, 0], [51, 90]
      ),
      [0, "EOF"]
    )
    const t = lesDxf(tekst)
    // 4 sider i rektangelet + 1 i den gamle polylinjen + buen
    expect(t.antallSegmenter).toBeGreaterThan(5)
    const s = Array.from(t.segmenter)
    expect(s.slice(0, 16)).toEqual([0, 0, 4, 0, 4, 0, 4, 3, 4, 3, 0, 3, 0, 3, 0, 0])
    expect(s.slice(16, 20)).toEqual([10, 10, 12, 10])
    // Buen ender i (0, 1)
    expect(s[s.length - 2]).toBeCloseTo(0, 5)
    expect(s[s.length - 1]).toBeCloseTo(1, 5)
  })

  it("blokker (INSERT) settes inn med flytting, skala og rotasjon", () => {
    const tekst = dxf(
      ...seksjon("BLOCKS", [0, "BLOCK"], [2, "DOR"], [10, 0], [20, 0], [0, "LINE"], [10, 0], [20, 0], [11, 1], [21, 0], [0, "ENDBLK"]),
      ...seksjon("ENTITIES", [0, "INSERT"], [2, "DOR"], [10, 10], [20, 5], [41, 2], [42, 2], [50, 90]),
      [0, "EOF"]
    )
    const s = Array.from(lesDxf(tekst).segmenter)
    expect(s[0]).toBeCloseTo(10)
    expect(s[1]).toBeCloseTo(5)
    expect(s[2]).toBeCloseTo(10)
    expect(s[3]).toBeCloseTo(7)
  })

  it("leser appens egen DXF-eksport tilbake", () => {
    const store = new CadStore(createEmptyModel("Test"))
    store.addRectangle(8, 6)
    const t = lesDxf(exportModelToDxf(store.getSnapshot().model))
    expect(t.antallSegmenter).toBeGreaterThan(4)
    expect(t.grenser!.maxX - t.grenser!.minX).toBeGreaterThan(7.9)
  })

  it("sier fra om binær DXF og filer som ikke er DXF", () => {
    expect(() => lesDxf("AutoCAD Binary DXF\r\n\u001a\u0000")).toThrow(DxfFeil)
    expect(() => lesDxf("hei")).toThrow(/ikke ut som en DXF/)
  })
})
