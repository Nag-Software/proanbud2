import { describe, expect, it } from "vitest"

import { elementGrenser, slaSammen, type GeometriDel } from "../../lib/cad/import/geometri"

const trekant = (x: number, element: number, farge: [number, number, number] = [1, 1, 1]): GeometriDel => ({
  posisjoner: [x, 0, 0, x + 1, 0, 0, x, 1, 0],
  farge,
  opasitet: 1,
  element,
})

describe("slaSammen", () => {
  it("slår sammen deler med samme farge til én gruppe, og holder styr på elementene", () => {
    const g = slaSammen(
      [trekant(0, 0), trekant(5, 1), trekant(10, 2, [1, 0, 0])],
      [
        { id: 11, navn: "Vegg A", type: "IfcWall" },
        { id: 12, navn: "Vegg B", type: "IfcWall" },
        { id: 13, navn: "Dør", type: "IfcDoor" },
      ]
    )
    expect(g.grupper).toHaveLength(2)
    expect(g.trekanter).toBe(3)
    const hvit = g.grupper.find((gruppe) => gruppe.farge[1] === 1)!
    expect(Array.from(hvit.indekser)).toEqual([0, 1, 2, 3, 4, 5])
    expect(Array.from(hvit.elementer)).toEqual([0, 0, 0, 1, 1, 1])
    expect(g.grenser).toEqual({ min: [0, 0, 0], max: [11, 1, 0] })
  })

  it("forskyver indekserte deler riktig", () => {
    const g = slaSammen(
      [
        { posisjoner: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], indekser: [0, 1, 2, 1, 3, 2], farge: [0.5, 0.5, 0.5], opasitet: 1, element: 0 },
        { posisjoner: [2, 0, 0, 3, 0, 0, 2, 1, 0], indekser: [0, 1, 2], farge: [0.5, 0.5, 0.5], opasitet: 1, element: 1 },
      ],
      [
        { id: 1, navn: "A", type: "x" },
        { id: 2, navn: "B", type: "x" },
      ]
    )
    expect(Array.from(g.grupper[0].indekser)).toEqual([0, 1, 2, 1, 3, 2, 4, 5, 6])
  })

  it("elementGrenser gir boksen rundt ett element", () => {
    const g = slaSammen([trekant(0, 0), trekant(5, 1)], [
      { id: 1, navn: "A", type: "x" },
      { id: 2, navn: "B", type: "x" },
    ])
    expect(elementGrenser(g, 1)).toEqual({ min: [5, 0, 0], max: [6, 1, 0] })
    expect(elementGrenser(g, 9)).toBeNull()
  })

  it("hopper over biter uten nok punkter", () => {
    const g = slaSammen([{ posisjoner: [0, 0, 0], farge: [1, 1, 1], opasitet: 1, element: 0 }], [])
    expect(g.grupper).toHaveLength(0)
    expect(g.grenser).toBeNull()
  })
})
