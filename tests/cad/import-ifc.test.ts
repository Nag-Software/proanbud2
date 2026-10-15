import { describe, expect, it } from "vitest"
import { IfcAPI } from "web-ifc"

import { exportModelToIfc } from "../../lib/cad/export/ifc"
import { tolkIfc } from "../../lib/cad/import/ifc-tolk"
import { createEmptyModel } from "../../lib/cad/schema"
import { CadStore } from "../../lib/cad/store"

// Leser appens egen IFC-eksport med web-ifc (Node-utgaven) og sjekker at
// importen blir i METER og med Y opp — det 3D-scenen forutsetter.
describe("tolkIfc", () => {
  it("leser en IFC fra appen: vegger i riktig størrelse, meter og Y opp", async () => {
    const store = new CadStore(createEmptyModel("Test"))
    store.addRectangle(8, 6)
    const ifc = exportModelToIfc(store.getSnapshot().model, { projectName: "Test" })

    const api = new IfcAPI()
    await api.Init(undefined, true)
    const id = api.OpenModel(new TextEncoder().encode(ifc), { COORDINATE_TO_ORIGIN: false })
    expect(id).toBeGreaterThanOrEqual(0)

    const geometri = tolkIfc(api, id)
    api.CloseModel(id)

    expect(geometri.trekanter).toBeGreaterThan(20)
    expect(geometri.elementer.filter((e) => e.type === "Vegg")).toHaveLength(4)
    const { min, max } = geometri.grenser!
    // 8 × 6 m utvendig (pluss veggtykkelse), 2,4 m høyt — Y er høyden.
    expect(max[0] - min[0]).toBeGreaterThan(7.9)
    expect(max[0] - min[0]).toBeLessThan(8.6)
    expect(max[1] - min[1]).toBeGreaterThan(2)
    expect(max[1] - min[1]).toBeLessThan(3.5)
    expect(max[2] - min[2]).toBeGreaterThan(5.9)
  }, 30_000)
})
