import { describe, expect, it } from "vitest"

import {
  computeWallFootprints,
  computeWallParts,
  expandOutline,
  footprintPolygon,
  prismMesh,
  roofHeightAt,
} from "@/lib/cad/geometry"
import { dedupePolygon, polygonArea, triangulatePolygon } from "@/lib/cad/math"
import { detectFaces, syncSpaces } from "@/lib/cad/rooms"
import { createEmptyModel, parseBuildingModel, sanitizeModel } from "@/lib/cad/schema"
import { computeTakeoff } from "@/lib/cad/takeoff"
import { exportModelToIfc } from "@/lib/cad/export/ifc"
import { exportModelToDxf } from "@/lib/cad/export/dxf"
import { exportModelToObj } from "@/lib/cad/export/obj"
import type { BuildingModel, Wall } from "@/lib/cad/types"

function wall(id: string, ax: number, ay: number, bx: number, by: number, overrides: Partial<Wall> = {}): Wall {
  return {
    id,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: 0.2,
    height: 2.4,
    baseOffset: 0,
    type: "exterior",
    openings: [],
    materialId: null,
    ...overrides,
  }
}

/** 6 × 4 m rektangel med 200 mm vegger, senterlinjer i (0,0)–(6,4). */
function rectangleWalls(): Wall[] {
  return [
    wall("w1", 0, 0, 6, 0),
    wall("w2", 6, 0, 6, 4),
    wall("w3", 6, 4, 0, 4),
    wall("w4", 0, 4, 0, 0),
  ]
}

function modelWithWalls(walls: Wall[]): BuildingModel {
  const model = createEmptyModel("Test")
  model.storeys[0].walls = walls
  return model
}

describe("veggfotavtrykk", () => {
  it("gjærer hjørnet slik at ytterkantene møtes i ett punkt", () => {
    const footprints = computeWallFootprints(rectangleWalls())
    const first = footprints.get("w1")!
    const second = footprints.get("w2")!

    // Ytterhjørnet i (6,0) skal ligge på (6.1, -0.1) for begge veggene.
    const firstOuterEnd = first.right[1]
    const secondOuterStart = second.right[0]

    expect(firstOuterEnd.x).toBeCloseTo(6.1, 6)
    expect(firstOuterEnd.y).toBeCloseTo(-0.1, 6)
    expect(secondOuterStart.x).toBeCloseTo(6.1, 6)
    expect(secondOuterStart.y).toBeCloseTo(-0.1, 6)
  })

  it("gir et fotavtrykk med riktig areal for en enkelt vegg", () => {
    const footprints = computeWallFootprints([wall("solo", 0, 0, 5, 0)])
    const polygon = footprintPolygon(footprints.get("solo")!)
    expect(polygonArea(polygon)).toBeCloseTo(5 * 0.2, 6)
  })

  it("forlenger veggen inn i naboen ved T-kryss", () => {
    const walls = [
      wall("through", 0, 0, 6, 0, { thickness: 0.3 }),
      wall("branch", 3, 0, 3, 4, { thickness: 0.1 }),
    ]
    const branch = computeWallFootprints(walls).get("branch")!
    // Starten skal skyves 0,15 m (halve gjennomgående vegg) bakover.
    expect(branch.uStart).toBeCloseTo(-0.15, 6)
  })
})

describe("åpninger deler veggen", () => {
  it("lager brystning og losholt rundt et vindu", () => {
    const target = wall("w", 0, 0, 4, 0, {
      openings: [
        {
          id: "o1",
          kind: "window",
          distance: 2,
          width: 1.2,
          height: 1.2,
          sill: 0.9,
          label: null,
          materialId: null,
        },
      ],
    })
    const footprint = computeWallFootprints([target]).get("w")!
    const parts = computeWallParts(target, footprint)

    const roles = parts.map((part) => part.role)
    expect(roles).toContain("under")
    expect(roles).toContain("over")

    const under = parts.find((part) => part.role === "under")!
    expect(under.y0).toBeCloseTo(0, 6)
    expect(under.y1).toBeCloseTo(0.9, 6)

    const over = parts.find((part) => part.role === "over")!
    expect(over.y0).toBeCloseTo(2.1, 6)
    expect(over.y1).toBeCloseTo(2.4, 6)
  })

  it("gir gjennomgående hull for en dør (ingen brystning)", () => {
    const target = wall("w", 0, 0, 4, 0, {
      openings: [
        {
          id: "o1",
          kind: "door",
          distance: 2,
          width: 0.9,
          height: 2.0,
          sill: 0,
          label: null,
          materialId: null,
        },
      ],
    })
    const footprint = computeWallFootprints([target]).get("w")!
    const parts = computeWallParts(target, footprint)
    expect(parts.some((part) => part.role === "under")).toBe(false)
    expect(parts.filter((part) => part.role === "over")).toHaveLength(1)
  })
})

describe("degenererte omriss", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 3 },
    { x: 0, y: 3 },
  ]

  function triangulatedArea(points: { x: number; y: number }[]) {
    const indices = triangulatePolygon(points)
    let sum = 0
    for (let i = 0; i < indices.length; i += 3) {
      const a = points[indices[i]]
      const b = points[indices[i + 1]]
      const c = points[indices[i + 2]]
      sum += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
    }
    return sum
  }

  it("fjerner punkter oppå hverandre og gjentatt startpunkt", () => {
    const messy = [...square, { x: 0, y: 3 }, { x: 0, y: 0 }]
    expect(dedupePolygon(messy)).toHaveLength(4)
  })

  it("triangulerer HELE flaten selv med dupliserte hjørner", () => {
    // Dette er dobbeltklikk-tilfellet: to punkt på samme sted i omrisset.
    // Før fiksen ga øreklippingen opp og returnerte et halvt lokk — dekket
    // ble en trekant i 3D.
    const withDuplicate = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 3 },
      { x: 0, y: 3 },
      { x: 0, y: 3 },
    ]
    expect(triangulatedArea(withDuplicate)).toBeCloseTo(12, 6)
  })

  it("triangulerer et rent rektangel til fullt areal", () => {
    expect(triangulatedArea(square)).toBeCloseTo(12, 6)
  })

  it("gir et lukket dekkevolum fra et omriss med duplikat", () => {
    const model = modelWithWalls(rectangleWalls())
    model.storeys[0].slabs = [
      {
        id: "sl1",
        kind: "floor",
        outline: [
          { x: 0, y: 0 },
          { x: 4, y: 0 },
          { x: 4, y: 3 },
          { x: 0, y: 3 },
          { x: 0, y: 3 },
        ],
        thickness: 0.2,
        offset: 0,
        materialId: null,
        label: null,
      },
    ]

    const clean = sanitizeModel(model)
    expect(clean.storeys[0].slabs[0].outline).toHaveLength(4)

    const takeoff = computeTakeoff(clean)
    expect(takeoff.totals.slabArea).toBeCloseTo(12, 3)
  })
})

describe("mesh", () => {
  it("bygger et lukket prisme med 12 trekanter for en firkant", () => {
    const mesh = prismMesh(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      0,
      2
    )
    expect(mesh.positions.length / 3).toBe(8)
    expect(mesh.indices.length / 3).toBe(12)
    // Ingen indeks utenfor punktlista.
    expect(Math.max(...mesh.indices)).toBeLessThan(8)
  })
})

describe("tak", () => {
  it("saltak er høyest på mønet og lavest på raftet", () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 6 },
      { x: 0, y: 6 },
    ]
    const roof = {
      id: "r",
      kind: "gable" as const,
      outline,
      baseHeight: 0,
      pitchDeg: 45,
      directionDeg: 0,
      thickness: 0.3,
      overhang: 0,
      materialId: null,
    }
    const center = { x: 4, y: 3 }
    // Mønet går langs x gjennom y = 3.
    expect(roofHeightAt(roof, { x: 4, y: 3 }, outline, center)).toBeCloseTo(3, 6)
    expect(roofHeightAt(roof, { x: 4, y: 0 }, outline, center)).toBeCloseTo(0, 6)
  })

  it("utstikk utvider omrisset utover", () => {
    const outline = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ]
    const expanded = expandOutline(outline, 0.5)
    expect(polygonArea(expanded)).toBeCloseTo(5 * 5, 5)
  })
})

describe("romdeteksjon", () => {
  it("finner ett rom i et lukket rektangel og bruker innvendig mål", () => {
    const faces = detectFaces(rectangleWalls())
    expect(faces).toHaveLength(1)
    // Innvendig: 6 - 0.2 = 5.8 × 4 - 0.2 = 3.8
    expect(faces[0].area).toBeCloseTo(5.8 * 3.8, 4)
  })

  it("finner to rom når en skillevegg deles inn", () => {
    const walls = [...rectangleWalls(), wall("mid", 3, 0, 3, 4, { type: "interior", thickness: 0.1 })]
    const faces = detectFaces(walls)
    expect(faces).toHaveLength(2)
  })

  it("beholder navnet på rommet når geometrien endres litt", () => {
    const first = syncSpaces(rectangleWalls(), [])
    expect(first).toHaveLength(1)
    const renamed = [{ ...first[0], name: "Stue" }]

    const moved = rectangleWalls().map((item) =>
      item.id === "w2" ? wall("w2", 6.2, 0, 6.2, 4) : item
    )
    // Flytt også naboveggenes endepunkter så rektangelet forblir lukket.
    moved[0] = wall("w1", 0, 0, 6.2, 0)
    moved[2] = wall("w3", 6.2, 4, 0, 4)

    const second = syncSpaces(moved, renamed)
    expect(second[0].name).toBe("Stue")
  })
})

describe("mengdeuttrekk", () => {
  it("trekker fra åpninger i veggarealet", () => {
    const walls = rectangleWalls()
    walls[0] = wall("w1", 0, 0, 6, 0, {
      openings: [
        {
          id: "o1",
          kind: "window",
          distance: 3,
          width: 2,
          height: 1.5,
          sill: 0.9,
          label: null,
          materialId: null,
        },
      ],
    })

    const model = modelWithWalls(walls)
    model.storeys[0].spaces = syncSpaces(walls, [])
    const takeoff = computeTakeoff(model)

    const grossPerimeter = (6 + 4) * 2
    const expected = grossPerimeter * 2.4 - 2 * 1.5
    expect(takeoff.totals.exteriorWallArea).toBeCloseTo(expected, 3)
    expect(takeoff.totals.windowCount).toBe(1)
  })

  it("regner skrått takareal, ikke projisert", () => {
    const model = modelWithWalls(rectangleWalls())
    model.storeys[0].roofs = [
      {
        id: "r",
        kind: "mono",
        outline: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 4 },
          { x: 0, y: 4 },
        ],
        baseHeight: 2.4,
        pitchDeg: 30,
        directionDeg: 0,
        thickness: 0.3,
        overhang: 0,
        materialId: null,
      },
    ]
    const takeoff = computeTakeoff(model)
    expect(takeoff.totals.roofArea).toBeCloseTo(24 / Math.cos((30 * Math.PI) / 180), 2)
  })

  it("legger på svinn og grupperer på materiale", () => {
    const model = modelWithWalls(rectangleWalls())
    const material = model.materials.find((item) => item.category === "wall")!
    material.wastePercent = 10
    material.measure = "area"
    material.unitPriceNok = 100
    for (const item of model.storeys[0].walls) item.materialId = material.id

    const takeoff = computeTakeoff(model)
    const group = takeoff.materials.find((item) => item.materialId === material.id)!
    const netArea = (6 + 4) * 2 * 2.4
    expect(group.quantity).toBeCloseTo(netArea, 2)
    expect(group.quantityWithWaste).toBeCloseTo(netArea * 1.1, 2)
    expect(group.totalNok).toBeCloseTo(netArea * 1.1 * 100, 0)
  })
})

describe("skjema", () => {
  it("kaster nullvegger og klemmer åpninger inn i veggen", () => {
    const model = modelWithWalls([
      wall("ok", 0, 0, 4, 0, {
        openings: [
          {
            id: "o1",
            kind: "window",
            distance: 10,
            width: 1,
            height: 1,
            sill: 0,
            label: null,
            materialId: null,
          },
        ],
      }),
      wall("degenerert", 1, 1, 1, 1),
    ])

    const clean = sanitizeModel(model)
    expect(clean.storeys[0].walls).toHaveLength(1)
    expect(clean.storeys[0].walls[0].openings[0].distance).toBeCloseTo(3.5, 6)
  })

  it("gir en tom, brukbar modell fra søppel-JSON", () => {
    const model = parseBuildingModel({ storeys: "nei", materials: 42 })
    expect(model.storeys).toHaveLength(1)
    expect(model.materials.length).toBeGreaterThan(0)
  })

  it("overlever en full rundtur gjennom JSON", () => {
    const model = modelWithWalls(rectangleWalls())
    const roundTripped = parseBuildingModel(JSON.parse(JSON.stringify(model)))
    expect(roundTripped.storeys[0].walls).toHaveLength(4)
  })
})

describe("eksport", () => {
  const model = (() => {
    const walls = rectangleWalls()
    walls[0] = wall("w1", 0, 0, 6, 0, {
      openings: [
        {
          id: "o1",
          kind: "window",
          distance: 3,
          width: 1.2,
          height: 1.2,
          sill: 0.9,
          label: "Stuevindu",
          materialId: null,
        },
        {
          id: "o2",
          kind: "door",
          distance: 1,
          width: 0.9,
          height: 2,
          sill: 0,
          label: "Ytterdør",
          materialId: null,
        },
      ],
    })
    const built = modelWithWalls(walls)
    built.storeys[0].spaces = syncSpaces(walls, [])
    built.storeys[0].slabs = [
      {
        id: "sl1",
        kind: "floor",
        outline: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 4 },
          { x: 0, y: 4 },
        ],
        thickness: 0.2,
        offset: 0,
        materialId: null,
      },
    ]
    built.storeys[0].roofs = [
      {
        id: "rf1",
        kind: "gable",
        outline: [
          { x: 0, y: 0 },
          { x: 6, y: 0 },
          { x: 6, y: 4 },
          { x: 0, y: 4 },
        ],
        baseHeight: 2.4,
        pitchDeg: 30,
        directionDeg: 0,
        thickness: 0.3,
        overhang: 0.4,
        materialId: null,
      },
    ]
    return built
  })()

  it("skriver en IFC4-fil med riktig ramme og BIM-objekter", () => {
    const ifc = exportModelToIfc(model, { projectName: "Testprosjekt" })

    expect(ifc.startsWith("ISO-10303-21;")).toBe(true)
    expect(ifc.trimEnd().endsWith("END-ISO-10303-21;")).toBe(true)
    expect(ifc).toContain("FILE_SCHEMA(('IFC4'))")
    expect(ifc).toContain("IFCPROJECT")
    expect(ifc).toContain("IFCBUILDINGSTOREY")
    expect(ifc).toContain("IFCWALLSTANDARDCASE")
    expect(ifc).toContain("IFCOPENINGELEMENT")
    expect(ifc).toContain("IFCRELVOIDSELEMENT")
    expect(ifc).toContain("IFCWINDOW")
    expect(ifc).toContain("IFCDOOR")
    expect(ifc).toContain("IFCSLAB")
    expect(ifc).toContain("IFCROOF")
    expect(ifc).toContain("IFCFACETEDBREP")

    // Alle entitetsreferanser må peke på en linje som finnes.
    const defined = new Set(Array.from(ifc.matchAll(/^#(\d+)=/gm), (match) => match[1]))
    const referenced = new Set(Array.from(ifc.matchAll(/[(,]#(\d+)/g), (match) => match[1]))
    for (const reference of referenced) {
      expect(defined.has(reference)).toBe(true)
    }
  })

  it("gir 22-tegns IFC-GUID-er", () => {
    const ifc = exportModelToIfc(model)
    const guids = Array.from(ifc.matchAll(/IFC[A-Z]+\('([^']+)'/g), (match) => match[1])
    expect(guids.length).toBeGreaterThan(5)
    for (const guid of guids) {
      expect(guid).toHaveLength(22)
      expect(guid).toMatch(/^[0-9A-Za-z_$]{22}$/)
    }
  })

  it("skriver en DXF som starter og slutter riktig", () => {
    const dxf = exportModelToDxf(model)
    expect(dxf).toContain("AC1009")
    expect(dxf).toContain("ENTITIES")
    expect(dxf.trimEnd().endsWith("EOF")).toBe(true)
    expect(dxf).toContain("LINE")
  })

  it("skriver OBJ med gyldige, 1-indekserte flater", () => {
    const obj = exportModelToObj(model)
    const vertexCount = obj.split("\n").filter((line) => line.startsWith("v ")).length
    const faces = obj.split("\n").filter((line) => line.startsWith("f "))
    expect(vertexCount).toBeGreaterThan(0)
    expect(faces.length).toBeGreaterThan(0)
    for (const face of faces) {
      for (const index of face.slice(2).split(" ")) {
        const value = Number(index)
        expect(value).toBeGreaterThanOrEqual(1)
        expect(value).toBeLessThanOrEqual(vertexCount)
      }
    }
  })
})
