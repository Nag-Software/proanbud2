/**
 * Tolker en IFC-modell med web-ifc til ImportGeometri. Skilt ut fra arbeideren
 * (ifc.worker.ts) så den kan testes i Node med web-ifc sin Node-utgave.
 */

import type { IfcAPI } from "web-ifc"

import { slaSammen, type GeometriDel, type ImportElement, type ImportGeometri } from "./geometri"

/** web-ifc-verdier er { value } eller rå tall/strenger. */
export function tekst(verdi: unknown): string {
  if (verdi === null || verdi === undefined) return ""
  if (typeof verdi === "object" && "value" in (verdi as object)) return tekst((verdi as { value: unknown }).value)
  if (typeof verdi === "number") return Number.isInteger(verdi) ? String(verdi) : verdi.toFixed(3).replace(/\.?0+$/, "")
  return String(verdi)
}

export function tolkIfc(api: IfcAPI, id: number, onFremdrift?: (andel: number) => void): ImportGeometri {
  const deler: GeometriDel[] = []
  const elementer: ImportElement[] = []
  const elementIndeks = new Map<number, number>()
  let sistRapportert = 0

  api.StreamAllMeshes(
    id,
    (mesh, index, totalt) => {
      let nr = elementIndeks.get(mesh.expressID)
      if (nr === undefined) {
        nr = elementer.length
        elementIndeks.set(mesh.expressID, nr)
        let type = "IFC-element"
        try {
          type = api.GetNameFromTypeCode(api.GetLineType(id, mesh.expressID))
        } catch {
          // Ukjent type: behold standardnavnet.
        }
        elementer.push({ id: mesh.expressID, navn: "", type: pentType(type) })
      }

      const plasserte = mesh.geometries
      for (let i = 0; i < plasserte.size(); i++) {
        const plassert = plasserte.get(i)
        const geometri = api.GetGeometry(id, plassert.geometryExpressID)
        const hjorner = api.GetVertexArray(geometri.GetVertexData(), geometri.GetVertexDataSize())
        const indekser = api.GetIndexArray(geometri.GetIndexData(), geometri.GetIndexDataSize())
        const m = plassert.flatTransformation
        const antall = hjorner.length / 6
        const posisjoner = new Float32Array(antall * 3)
        const normaler = new Float32Array(antall * 3)
        for (let v = 0; v < antall; v++) {
          const x = hjorner[v * 6]
          const y = hjorner[v * 6 + 1]
          const z = hjorner[v * 6 + 2]
          const nx = hjorner[v * 6 + 3]
          const ny = hjorner[v * 6 + 4]
          const nz = hjorner[v * 6 + 5]
          // Kolonnevis 4×4 (three/WebGL-rekkefølge).
          posisjoner[v * 3] = m[0] * x + m[4] * y + m[8] * z + m[12]
          posisjoner[v * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]
          posisjoner[v * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14]
          normaler[v * 3] = m[0] * nx + m[4] * ny + m[8] * nz
          normaler[v * 3 + 1] = m[1] * nx + m[5] * ny + m[9] * nz
          normaler[v * 3 + 2] = m[2] * nx + m[6] * ny + m[10] * nz
        }
        deler.push({
          posisjoner,
          normaler,
          indekser: indekser.slice(),
          farge: [plassert.color.x, plassert.color.y, plassert.color.z],
          opasitet: plassert.color.w,
          element: nr,
        })
        geometri.delete()
      }

      if (totalt > 0 && index - sistRapportert > totalt / 20) {
        sistRapportert = index
        onFremdrift?.(index / totalt)
      }
    },
    true
  )

  // Navn hentes etterpå (én gang per element), ikke inne i strømmen.
  for (const element of elementer) {
    try {
      const linje = api.GetLine(id, element.id)
      element.navn = tekst(linje?.Name) || tekst(linje?.ObjectType) || ""
    } catch {
      // Ikke alle elementer har navn.
    }
  }

  const geometri = slaSammen(deler, elementer)
  if (geometri.grupper.length === 0) {
    throw new Error("Fant ingen geometri i IFC-fila. Den kan inneholde bare data uten 3D-former.")
  }
  return geometri
}

/** «IFCWALLSTANDARDCASE» → «IfcWallStandardCase». */
export function pentType(type: string): string {
  if (!type.toUpperCase().startsWith("IFC")) return type
  const kjente: Record<string, string> = {
    IFCWALL: "Vegg",
    IFCWALLSTANDARDCASE: "Vegg",
    IFCSLAB: "Dekke",
    IFCROOF: "Tak",
    IFCDOOR: "Dør",
    IFCWINDOW: "Vindu",
    IFCBEAM: "Bjelke",
    IFCCOLUMN: "Søyle",
    IFCSTAIR: "Trapp",
    IFCSTAIRFLIGHT: "Trappeløp",
    IFCRAILING: "Rekkverk",
    IFCCOVERING: "Kledning",
    IFCPLATE: "Plate",
    IFCMEMBER: "Stender/del",
    IFCFOOTING: "Fundament",
    IFCFURNISHINGELEMENT: "Innredning",
    IFCFLOWTERMINAL: "VVS/elektro",
    IFCFLOWSEGMENT: "Rør/kanal",
    IFCSPACE: "Rom",
    IFCOPENINGELEMENT: "Åpning",
    IFCBUILDINGELEMENTPROXY: "Bygningsdel",
  }
  return kjente[type.toUpperCase()] ?? type
}
