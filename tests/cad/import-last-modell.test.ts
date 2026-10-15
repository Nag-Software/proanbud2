import * as THREE from "three"
import { describe, expect, it } from "vitest"

import { komprimer, lastModell, tilGeometri } from "../../lib/cad/import/last-modell"

const enc = (tekst: string) => new TextEncoder().encode(tekst).buffer as ArrayBuffer

const OBJ_KUBE = `o Kube
v 0 0 0
v 2 0 0
v 2 3 0
v 0 3 0
f 1 2 3
f 1 3 4
`

const STL_ASCII = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1000 0 0
  vertex 0 1000 0
 endloop
endfacet
endsolid t
`

describe("lastModell (three.js-lesere)", () => {
  it("leser OBJ til én gruppe med riktige grenser og et navngitt element", async () => {
    const m = await lastModell("obj", enc(OBJ_KUBE))
    expect(m.geometri.trekanter).toBe(2)
    expect(m.geometri.grenser).toEqual({ min: [0, 0, 0], max: [2, 3, 0] })
    expect(m.geometri.elementer[0].navn).toBe("Kube")
  })

  it("leser ASCII-STL (her i millimeter, enheten rettes i UI-et)", async () => {
    const m = await lastModell("stl", enc(STL_ASCII))
    expect(m.geometri.trekanter).toBe(1)
    expect(m.geometri.grenser!.max[0]).toBe(1000)
  })

  it("dropper normaler som er null (STL med «facet normal 0 0 0»), så de regnes ut", async () => {
    const m = await lastModell("stl", enc(STL_ASCII.replace("facet normal 0 0 1", "facet normal 0 0 0")))
    expect(m.geometri.grupper[0].normaler).toBeNull()
    const medNormaler = await lastModell("stl", enc(STL_ASCII))
    expect(medNormaler.geometri.grupper[0].normaler).not.toBeNull()
  })

  it("gir en forståelig feil for en tegning sendt som 3D", async () => {
    await expect(lastModell("pdf", new ArrayBuffer(4))).rejects.toThrow(/tegning/)
  })
})

describe("tilGeometri", () => {
  it("tar med verdensplassering og deler meshet per materiale", async () => {
    const geometri = new THREE.BoxGeometry(1, 1, 1)
    const mesh = new THREE.Mesh(geometri, [
      new THREE.MeshStandardMaterial({ color: "#ff0000" }),
      new THREE.MeshStandardMaterial({ color: "#00ff00" }),
      new THREE.MeshStandardMaterial({ color: "#0000ff" }),
      new THREE.MeshStandardMaterial({ color: "#ff0000" }),
      new THREE.MeshStandardMaterial({ color: "#00ff00" }),
      new THREE.MeshStandardMaterial({ color: "#0000ff" }),
    ])
    mesh.position.set(10, 0, 0)
    const gruppe = new THREE.Group()
    gruppe.add(mesh)
    const g = await tilGeometri(gruppe, "glb")
    expect(g.grupper).toHaveLength(3)
    expect(g.trekanter).toBe(12)
    expect(g.grenser!.min[0]).toBeCloseTo(9.5)
    expect(g.grenser!.max[0]).toBeCloseTo(10.5)
    // Hver fargegruppe har bare punktene den bruker (2 sider × 4 punkter).
    for (const gr of g.grupper) expect(gr.posisjoner.length).toBe(8 * 3)
  })
})

describe("komprimer", () => {
  it("plukker ut brukte punkter og nummererer dem på nytt", () => {
    const pos = new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3])
    const k = komprimer(pos, null, [3, 1, 3])
    expect(Array.from(k.posisjoner)).toEqual([3, 3, 3, 1, 1, 1])
    expect(k.indekser).toEqual([0, 1, 0])
  })
})
