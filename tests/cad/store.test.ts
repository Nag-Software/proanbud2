import { describe, expect, it } from "vitest"

import { CadStore } from "@/lib/cad/store"
import { createEmptyModel } from "@/lib/cad/schema"
import { polygonArea } from "@/lib/cad/math"
import { computeTakeoff } from "@/lib/cad/takeoff"

function newStore() {
  return new CadStore(createEmptyModel("Test"))
}

function activeStorey(store: CadStore) {
  const state = store.getSnapshot()
  return state.model.storeys.find((storey) => storey.id === state.activeStoreyId)!
}

describe("rektangel-snarveien", () => {
  it("lager fire yttervegger, gulv og ett rom", () => {
    const store = newStore()
    store.addRectangle(8, 6, { withFloor: true })

    const storey = activeStorey(store)
    expect(storey.walls).toHaveLength(4)
    expect(storey.walls.every((wall) => wall.type === "exterior")).toBe(true)
    expect(storey.slabs).toHaveLength(1)
    expect(storey.spaces).toHaveLength(1)

    // Innvendig mål: 8 - 0,25 = 7,75 og 6 - 0,25 = 5,75.
    expect(polygonArea(storey.spaces[0].outline)).toBeCloseTo(7.75 * 5.75, 2)
  })

  it("kan angres i ett steg", () => {
    const store = newStore()
    store.addRectangle(8, 6, { withFloor: true })
    expect(activeStorey(store).walls).toHaveLength(4)

    store.undo()
    expect(activeStorey(store).walls).toHaveLength(0)
  })
})

describe("rotering", () => {
  it("roterer hele etasjen uten å endre arealer", () => {
    const store = newStore()
    store.addRectangle(8, 6, { withFloor: true })
    const before = computeTakeoff(store.getSnapshot().model)

    store.rotateStorey(90)
    const after = computeTakeoff(store.getSnapshot().model)

    expect(after.totals.grossFloorArea).toBeCloseTo(before.totals.grossFloorArea, 2)
    expect(after.totals.exteriorWallArea).toBeCloseTo(before.totals.exteriorWallArea, 2)
    expect(after.totals.roomCount).toBe(before.totals.roomCount)
  })

  it("snur bygget slik at bredde og dybde bytter plass", () => {
    const store = newStore()
    store.addRectangle(10, 4)

    const spanBefore = activeStorey(store).walls.flatMap((wall) => [wall.a.x, wall.b.x])
    const widthBefore = Math.max(...spanBefore) - Math.min(...spanBefore)
    expect(widthBefore).toBeCloseTo(10, 3)

    store.rotateStorey(90)

    const spanAfter = activeStorey(store).walls.flatMap((wall) => [wall.a.x, wall.b.x])
    const widthAfter = Math.max(...spanAfter) - Math.min(...spanAfter)
    expect(widthAfter).toBeCloseTo(4, 3)
  })

  it("setter veggretning om startpunktet, med lengden i behold", () => {
    const store = newStore()
    const wallId = store.addWall({ x: 0, y: 0 }, { x: 4, y: 0 })!

    store.setWallAngle(wallId, 90)

    const wall = activeStorey(store).walls.find((item) => item.id === wallId)!
    expect(wall.a).toEqual({ x: 0, y: 0 })
    expect(wall.b.x).toBeCloseTo(0, 3)
    expect(wall.b.y).toBeCloseTo(4, 3)
  })

  it("roterer et valgt dekke om sitt eget senter", () => {
    const store = newStore()
    const slabId = store.addSlab([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 2 },
      { x: 0, y: 2 },
    ])!
    const storeyId = activeStorey(store).id
    store.setSelection({ kind: "slab", id: slabId, storeyId })

    const areaBefore = polygonArea(activeStorey(store).slabs[0].outline)
    store.rotateSelection(90)
    const after = activeStorey(store).slabs[0].outline

    expect(polygonArea(after)).toBeCloseTo(areaBefore, 3)
    // 4 × 2 blir 2 × 4 etter en kvart omdreining.
    const xs = after.map((point) => point.x)
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 3)
  })
})

describe("T-skjøt følger når veggen flyttes", () => {
  it("drar skilleveggen med seg vinkelrett", () => {
    const store = newStore()
    store.addRectangle(8, 6)
    // Skillevegg fra midten av sørveggen opp til nordveggen.
    const partitionId = store.addWall({ x: 4, y: 0 }, { x: 4, y: 6 }, "interior")!

    // Flytt sørveggen (y = 0) ned et halvt meter.
    const southWall = activeStorey(store).walls.find(
      (wall) => wall.a.y === 0 && wall.b.y === 0 && wall.id !== partitionId
    )!
    store.moveWall(southWall.id, { x: 0, y: -0.5 })

    const partition = activeStorey(store).walls.find((wall) => wall.id === partitionId)!
    // Enden som lå på sørveggen skal ha fulgt etter.
    expect(Math.min(partition.a.y, partition.b.y)).toBeCloseTo(-0.5, 3)
    // Den andre enden står stille.
    expect(Math.max(partition.a.y, partition.b.y)).toBeCloseTo(6, 3)
  })
})

describe("angre og gjenta", () => {
  it("ett drag gir én angre-post", () => {
    const store = newStore()
    store.addRectangle(6, 4)
    const wallId = activeStorey(store).walls[0].id

    // Simuler et drag: mange transiente steg, én commit.
    for (let i = 0; i < 10; i++) {
      store.moveWall(wallId, { x: 0, y: -0.1 }, { transient: true })
    }
    store.commitTransient()

    const movedY = activeStorey(store).walls.find((wall) => wall.id === wallId)!.a.y
    expect(movedY).toBeCloseTo(-1, 3)

    store.undo()
    const restoredY = activeStorey(store).walls.find((wall) => wall.id === wallId)!.a.y
    expect(restoredY).toBeCloseTo(0, 3)
  })
})

describe("omriss-redigering", () => {
  function storeWithRoof() {
    const store = newStore()
    store.addRectangle(8, 6)
    const roofId = store.addRoof(
      [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 6 },
        { x: 0, y: 6 },
      ],
      "gable"
    )!
    const storeyId = activeStorey(store).id
    store.setSelection({ kind: "roof", id: roofId, storeyId })
    return { store, roofId }
  }

  it("flytter ett hjørne uten å røre de andre", () => {
    const { store, roofId } = storeWithRoof()
    store.moveOutlinePoint("roof", roofId, 1, { x: 10, y: 0 })

    const outline = activeStorey(store).roofs.find((item) => item.id === roofId)!.outline
    expect(outline[1]).toEqual({ x: 10, y: 0 })
    expect(outline[0]).toEqual({ x: 0, y: 0 })
    expect(outline[2]).toEqual({ x: 8, y: 6 })
  })

  it("flytter en kant sidelengs — begge endepunktene følger", () => {
    const { store, roofId } = storeWithRoof()
    // Kant 1 går fra (8,0) til (8,6): høyre side.
    store.moveOutlineEdge("roof", roofId, 1, { x: 1.5, y: 0 })

    const outline = activeStorey(store).roofs.find((item) => item.id === roofId)!.outline
    expect(outline[1]).toEqual({ x: 9.5, y: 0 })
    expect(outline[2]).toEqual({ x: 9.5, y: 6 })
    expect(outline[0]).toEqual({ x: 0, y: 0 })
    expect(outline[3]).toEqual({ x: 0, y: 6 })
  })

  it("setter inn et hjørne midt på kanten, og kan fjerne det igjen", () => {
    const { store, roofId } = storeWithRoof()

    store.insertOutlinePoint("roof", roofId, 0)
    let outline = activeStorey(store).roofs.find((item) => item.id === roofId)!.outline
    expect(outline).toHaveLength(5)
    expect(outline[1]).toEqual({ x: 4, y: 0 })

    store.removeOutlinePoint("roof", roofId, 1)
    outline = activeStorey(store).roofs.find((item) => item.id === roofId)!.outline
    expect(outline).toHaveLength(4)
  })

  it("nekter å fjerne hjørne når det bare er tre igjen", () => {
    const store = newStore()
    const slabId = store.addSlab([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ])!
    store.removeOutlinePoint("slab", slabId, 0)
    expect(activeStorey(store).slabs[0].outline).toHaveLength(3)
  })

  it("oppdaterer takflaten i mengdeuttrekket når taket strekkes", () => {
    const { store, roofId } = storeWithRoof()
    const before = computeTakeoff(store.getSnapshot().model).totals.roofArea

    store.moveOutlineEdge("roof", roofId, 1, { x: 2, y: 0 })
    const after = computeTakeoff(store.getSnapshot().model).totals.roofArea

    expect(after).toBeGreaterThan(before)
  })
})
