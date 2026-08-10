/**
 * IFC4-eksport (ISO 16739 / STEP Physical File).
 *
 * IFC er standardformatet i byggebransjen — det er dette arkitekt, RIB og
 * entreprenør kan åpne i Solibri, Revit, ArchiCAD, BIMcollab, Naviate osv.
 * Derfor eksporterer vi ekte BIM-objekter, ikke en trekantsuppe:
 *
 *   - Vegger blir IfcWallStandardCase med IfcExtrudedAreaSolid.
 *   - Dører og vinduer blir IfcOpeningElement (IfcRelVoidsElement) med
 *     IfcDoor/IfcWindow som fyller åpningen (IfcRelFillsElement). Det er dette
 *     som gjør at mottakeren faktisk får hull i veggen og tellbare vinduer.
 *   - Etasjer blir IfcBuildingStorey med riktig romlig hierarki
 *     (IfcProject → IfcSite → IfcBuilding → IfcBuildingStorey → elementer).
 *   - Tak eksporteres som IfcRoof med IfcFacetedBrep, siden saltak ikke er en
 *     ren ekstrudering.
 *   - Materialene brukeren har valgt følger med som IfcMaterial.
 *
 * Koordinater: IFC bruker X øst, Y nord, Z opp — samme som modellens
 * plan-koordinater med høyde. Ingen konvertering nødvendig, bortsett fra for
 * mesh-geometri, som lagres i three.js-konvensjon.
 */

import { computeWallFootprints, footprintPolygon, roofMesh, expandOutline } from "../geometry"
import { signedArea } from "../math"
import { OPENING_LABELS } from "../presets"
import type { BuildingModel, Point, SolidMesh, Wall } from "../types"

const IFC_GUID_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$"

/**
 * IFC bruker en komprimert 22-tegns base64-variant av en UUID (IfcGloballyUniqueId).
 * Rå UUID-er er ugyldige og avvises av strenge lesere som Solibri.
 */
export function ifcGuid(): string {
  const hex =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replace(/-/g, "")
      : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("")

  const chunks = [
    { value: parseInt(hex.slice(0, 2), 16), length: 2 },
    { value: parseInt(hex.slice(2, 8), 16), length: 4 },
    { value: parseInt(hex.slice(8, 14), 16), length: 4 },
    { value: parseInt(hex.slice(14, 20), 16), length: 4 },
    { value: parseInt(hex.slice(20, 26), 16), length: 4 },
    { value: parseInt(hex.slice(26, 32), 16), length: 4 },
  ]

  return chunks
    .map(({ value, length }) => {
      let out = ""
      let remaining = value
      for (let i = 0; i < length; i++) {
        out = IFC_GUID_CHARS[remaining % 64] + out
        remaining = Math.floor(remaining / 64)
      }
      return out
    })
    .join("")
}

function escapeIfcString(value: string) {
  // STEP-strenger: apostrof dobles, backslash dobles. Ikke-ASCII skrives som
  // \X2\...\X0\ (UTF-16), ellers havarerer æ/ø/å hos mottakeren.
  const escaped = value.replace(/\\/g, "\\\\").replace(/'/g, "''")
  let result = ""
  let buffer = ""

  const flush = () => {
    if (!buffer) return
    result += `\\X2\\${buffer}\\X0\\`
    buffer = ""
  }

  for (const char of escaped) {
    const code = char.codePointAt(0) ?? 0
    if (code < 128) {
      flush()
      result += char
    } else {
      for (let i = 0; i < char.length; i++) {
        buffer += char.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0")
      }
    }
  }
  flush()
  return result
}

function num(value: number) {
  if (!Number.isFinite(value)) return "0."
  const rounded = Math.round(value * 1e6) / 1e6
  return Number.isInteger(rounded) ? `${rounded}.` : `${rounded}`
}

class StepFile {
  private lines: string[] = []
  private nextId = 1

  add(entity: string) {
    const id = this.nextId++
    this.lines.push(`#${id}=${entity};`)
    return `#${id}`
  }

  toString(modelName: string) {
    const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "")
    return [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');",
      `FILE_NAME('${escapeIfcString(modelName)}','${timestamp}',('ProAnbud'),('ProAnbud AS'),'ProAnbud CAD','ProAnbud','');`,
      "FILE_SCHEMA(('IFC4'));",
      "ENDSEC;",
      "DATA;",
      ...this.lines,
      "ENDSEC;",
      "END-ISO-10303-21;",
      "",
    ].join("\n")
  }
}

type IfcContext = {
  step: StepFile
  ownerHistory: string
  context: string
  materialRefs: Map<string, string>
}

function cartesianPoint3d(step: StepFile, x: number, y: number, z: number) {
  return step.add(`IFCCARTESIANPOINT((${num(x)},${num(y)},${num(z)}))`)
}

function axisPlacement(step: StepFile, x: number, y: number, z: number) {
  return step.add(`IFCAXIS2PLACEMENT3D(${cartesianPoint3d(step, x, y, z)},$,$)`)
}

/**
 * Profil til ekstrudering. IFC vil ha polygonet mot klokka og lukket via
 * gjentatt startpunkt i IfcPolyline.
 */
function closedProfile(step: StepFile, profile: Point[], name: string) {
  const outline = signedArea(profile) < 0 ? [...profile].reverse() : profile
  const pointRefs = outline.map((point) =>
    step.add(`IFCCARTESIANPOINT((${num(point.x)},${num(point.y)}))`)
  )
  const polyline = step.add(`IFCPOLYLINE((${[...pointRefs, pointRefs[0]].join(",")}))`)
  return step.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'${escapeIfcString(name)}',${polyline})`)
}

function extrudedSolid(step: StepFile, profile: Point[], z0: number, height: number, name: string) {
  const profileRef = closedProfile(step, profile, name)
  const placement = axisPlacement(step, 0, 0, z0)
  const direction = step.add("IFCDIRECTION((0.,0.,1.))")
  return step.add(`IFCEXTRUDEDAREASOLID(${profileRef},${placement},${direction},${num(height)})`)
}

/** Trekantnett → IfcFacetedBrep. Mesh ligger i three.js-akser og snus tilbake. */
function facetedBrep(step: StepFile, mesh: SolidMesh) {
  const pointRefs: string[] = []
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i]
    const height = mesh.positions[i + 1]
    const y = -mesh.positions[i + 2]
    pointRefs.push(cartesianPoint3d(step, x, y, height))
  }

  const faces: string[] = []
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = pointRefs[mesh.indices[i]]
    const b = pointRefs[mesh.indices[i + 1]]
    const c = pointRefs[mesh.indices[i + 2]]
    if (!a || !b || !c || a === b || b === c || a === c) continue
    const loop = step.add(`IFCPOLYLOOP((${a},${b},${c}))`)
    const bound = step.add(`IFCFACEOUTERBOUND(${loop},.T.)`)
    faces.push(step.add(`IFCFACE((${bound}))`))
  }

  if (faces.length === 0) return null
  const shell = step.add(`IFCCLOSEDSHELL((${faces.join(",")}))`)
  return step.add(`IFCFACETEDBREP(${shell})`)
}

function shapeRepresentation(
  ifc: IfcContext,
  items: string[],
  representationType: "SweptSolid" | "Brep"
) {
  const representation = ifc.step.add(
    `IFCSHAPEREPRESENTATION(${ifc.context},'Body','${representationType}',(${items.join(",")}))`
  )
  return ifc.step.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${representation}))`)
}

function localPlacement(ifc: IfcContext, parent: string | null, z = 0) {
  const placement = axisPlacement(ifc.step, 0, 0, z)
  return ifc.step.add(`IFCLOCALPLACEMENT(${parent ?? "$"},${placement})`)
}

function associateMaterial(ifc: IfcContext, productRef: string, materialName: string | null) {
  if (!materialName) return
  let materialRef = ifc.materialRefs.get(materialName)
  if (!materialRef) {
    materialRef = ifc.step.add(`IFCMATERIAL('${escapeIfcString(materialName)}',$,$)`)
    ifc.materialRefs.set(materialName, materialRef)
  }
  ifc.step.add(
    `IFCRELASSOCIATESMATERIAL('${ifcGuid()}',${ifc.ownerHistory},$,$,(${productRef}),${materialRef})`
  )
}

function wallFullProfile(wall: Wall, footprintPoints: Point[]) {
  return footprintPoints.length >= 3 ? footprintPoints : [wall.a, wall.b]
}

export type IfcExportOptions = {
  projectName?: string
  siteName?: string
  buildingName?: string
  authorName?: string
}

export function exportModelToIfc(model: BuildingModel, options: IfcExportOptions = {}) {
  const step = new StepFile()

  // --- Eier/applikasjon ---------------------------------------------------
  const person = step.add(
    `IFCPERSON($,$,'${escapeIfcString(options.authorName || "ProAnbud")}',$,$,$,$,$)`
  )
  const organization = step.add("IFCORGANIZATION($,'ProAnbud',$,$,$)")
  const personAndOrganization = step.add(
    `IFCPERSONANDORGANIZATION(${person},${organization},$)`
  )
  const application = step.add(
    `IFCAPPLICATION(${organization},'1.0','ProAnbud CAD','PROANBUD-CAD')`
  )
  const ownerHistory = step.add(
    `IFCOWNERHISTORY(${personAndOrganization},${application},$,.ADDED.,$,$,$,${Math.floor(
      Date.now() / 1000
    )})`
  )

  // --- Enheter og kontekst ------------------------------------------------
  const lengthUnit = step.add("IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)")
  const areaUnit = step.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)")
  const volumeUnit = step.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)")
  const angleUnit = step.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)")
  const unitAssignment = step.add(
    `IFCUNITASSIGNMENT((${lengthUnit},${areaUnit},${volumeUnit},${angleUnit}))`
  )

  const worldOrigin = axisPlacement(step, 0, 0, 0)
  const trueNorth = step.add("IFCDIRECTION((0.,1.))")
  const context = step.add(
    `IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${worldOrigin},${trueNorth})`
  )

  const ifc: IfcContext = {
    step,
    ownerHistory,
    context,
    materialRefs: new Map(),
  }

  // --- Romlig hierarki ----------------------------------------------------
  const project = step.add(
    `IFCPROJECT('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
      options.projectName || model.name
    )}',$,$,$,$,(${context}),${unitAssignment})`
  )

  const sitePlacement = localPlacement(ifc, null, 0)
  const site = step.add(
    `IFCSITE('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
      options.siteName || "Byggeplass"
    )}',$,$,${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`
  )

  const buildingPlacement = localPlacement(ifc, sitePlacement, 0)
  const building = step.add(
    `IFCBUILDING('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
      options.buildingName || model.name
    )}',$,$,${buildingPlacement},$,$,.ELEMENT.,$,$,$)`
  )

  step.add(
    `IFCRELAGGREGATES('${ifcGuid()}',${ownerHistory},$,$,${project},(${site}))`
  )
  step.add(`IFCRELAGGREGATES('${ifcGuid()}',${ownerHistory},$,$,${site},(${building}))`)

  const materialsById = new Map(model.materials.map((material) => [material.id, material]))
  const storeyRefs: string[] = []

  for (const storey of model.storeys) {
    const storeyPlacement = localPlacement(ifc, buildingPlacement, storey.elevation)
    const storeyRef = step.add(
      `IFCBUILDINGSTOREY('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
        storey.name
      )}',$,$,${storeyPlacement},$,$,.ELEMENT.,${num(storey.elevation)})`
    )
    storeyRefs.push(storeyRef)

    const contained: string[] = []
    const footprints = computeWallFootprints(storey.walls)

    for (const wall of storey.walls) {
      const footprint = footprints.get(wall.id)
      if (!footprint) continue

      const profile = wallFullProfile(wall, footprintPolygon(footprint))
      const base = storey.elevation + wall.baseOffset
      const solid = extrudedSolid(step, profile, base, wall.height, "Vegg")
      const shape = shapeRepresentation(ifc, [solid], "SweptSolid")
      const placement = localPlacement(ifc, storeyPlacement, 0)

      const wallRef = step.add(
        `IFCWALLSTANDARDCASE('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
          wall.label || (wall.type === "exterior" ? "Yttervegg" : "Innervegg")
        )}',$,$,${placement},${shape},$,$)`
      )
      contained.push(wallRef)
      associateMaterial(ifc, wallRef, materialsById.get(wall.materialId || "")?.name ?? null)

      // Åpninger: eget volum som trekkes fra veggen, pluss dør/vindu som fyller.
      const span = footprint.uEnd - footprint.uStart
      for (const opening of wall.openings) {
        if (span <= 1e-6) continue
        const t0 = (opening.distance - opening.width / 2 - footprint.uStart) / span
        const t1 = (opening.distance + opening.width / 2 - footprint.uStart) / span
        const quad = quadAt(footprint.left, footprint.right, t0, t1)
        const openingZ = base + opening.sill

        const openingSolid = extrudedSolid(step, quad, openingZ, opening.height, "Åpning")
        const openingShape = shapeRepresentation(ifc, [openingSolid], "SweptSolid")
        const openingPlacement = localPlacement(ifc, storeyPlacement, 0)
        const openingRef = step.add(
          `IFCOPENINGELEMENT('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
            OPENING_LABELS[opening.kind]
          )}',$,$,${openingPlacement},${openingShape},$,.OPENING.)`
        )
        step.add(
          `IFCRELVOIDSELEMENT('${ifcGuid()}',${ownerHistory},$,$,${wallRef},${openingRef})`
        )

        if (opening.kind === "opening") continue

        const fillSolid = extrudedSolid(step, quad, openingZ, opening.height, "Fylling")
        const fillShape = shapeRepresentation(ifc, [fillSolid], "SweptSolid")
        const fillPlacement = localPlacement(ifc, storeyPlacement, 0)
        const label = escapeIfcString(opening.label || OPENING_LABELS[opening.kind])
        const fillRef =
          opening.kind === "door"
            ? step.add(
                `IFCDOOR('${ifcGuid()}',${ownerHistory},'${label}',$,$,${fillPlacement},${fillShape},$,${num(
                  opening.height
                )},${num(opening.width)},$,$,$)`
              )
            : step.add(
                `IFCWINDOW('${ifcGuid()}',${ownerHistory},'${label}',$,$,${fillPlacement},${fillShape},$,${num(
                  opening.height
                )},${num(opening.width)},$,$,$)`
              )
        contained.push(fillRef)
        step.add(
          `IFCRELFILLSELEMENT('${ifcGuid()}',${ownerHistory},$,$,${openingRef},${fillRef})`
        )
        associateMaterial(ifc, fillRef, materialsById.get(opening.materialId || "")?.name ?? null)
      }
    }

    for (const slab of storey.slabs) {
      if (slab.outline.length < 3) continue
      const top = storey.elevation + slab.offset
      const solid = extrudedSolid(step, slab.outline, top - slab.thickness, slab.thickness, "Dekke")
      const shape = shapeRepresentation(ifc, [solid], "SweptSolid")
      const placement = localPlacement(ifc, storeyPlacement, 0)
      const predefined = slab.kind === "foundation" ? ".BASESLAB." : ".FLOOR."
      const slabRef = step.add(
        `IFCSLAB('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
          slab.label || "Dekke"
        )}',$,$,${placement},${shape},$,${predefined})`
      )
      contained.push(slabRef)
      associateMaterial(ifc, slabRef, materialsById.get(slab.materialId || "")?.name ?? null)
    }

    for (const column of storey.columns) {
      const half = { width: column.width / 2, depth: column.depth / 2 }
      const outline: Point[] = [
        { x: column.position.x - half.width, y: column.position.y - half.depth },
        { x: column.position.x + half.width, y: column.position.y - half.depth },
        { x: column.position.x + half.width, y: column.position.y + half.depth },
        { x: column.position.x - half.width, y: column.position.y + half.depth },
      ]
      const base = storey.elevation + column.baseOffset
      const solid = extrudedSolid(step, outline, base, column.height, "Søyle")
      const shape = shapeRepresentation(ifc, [solid], "SweptSolid")
      const placement = localPlacement(ifc, storeyPlacement, 0)
      const columnRef = step.add(
        `IFCCOLUMN('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
          column.label || "Søyle"
        )}',$,$,${placement},${shape},$,$)`
      )
      contained.push(columnRef)
      associateMaterial(ifc, columnRef, materialsById.get(column.materialId || "")?.name ?? null)
    }

    for (const roof of storey.roofs) {
      const outline = roof.overhang > 0 ? expandOutline(roof.outline, roof.overhang) : roof.outline
      const mesh = roofMesh(roof, storey.elevation, outline)
      const brep = facetedBrep(step, mesh)
      if (!brep) continue
      const shape = shapeRepresentation(ifc, [brep], "Brep")
      const placement = localPlacement(ifc, storeyPlacement, 0)
      const roofRef = step.add(
        `IFCROOF('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
          roof.label || "Tak"
        )}',$,$,${placement},${shape},$,$)`
      )
      contained.push(roofRef)
      associateMaterial(ifc, roofRef, materialsById.get(roof.materialId || "")?.name ?? null)
    }

    for (const space of storey.spaces) {
      if (space.outline.length < 3) continue
      const solid = extrudedSolid(step, space.outline, storey.elevation, storey.height, "Rom")
      const shape = shapeRepresentation(ifc, [solid], "SweptSolid")
      const placement = localPlacement(ifc, storeyPlacement, 0)
      const spaceRef = step.add(
        `IFCSPACE('${ifcGuid()}',${ownerHistory},'${escapeIfcString(
          space.name
        )}',$,$,${placement},${shape},$,.ELEMENT.,.INTERNAL.,${num(storey.elevation)})`
      )
      step.add(
        `IFCRELAGGREGATES('${ifcGuid()}',${ownerHistory},$,$,${storeyRef},(${spaceRef}))`
      )
    }

    if (contained.length > 0) {
      step.add(
        `IFCRELCONTAINEDINSPATIALSTRUCTURE('${ifcGuid()}',${ownerHistory},$,$,(${contained.join(
          ","
        )}),${storeyRef})`
      )
    }
  }

  if (storeyRefs.length > 0) {
    step.add(
      `IFCRELAGGREGATES('${ifcGuid()}',${ownerHistory},$,$,${building},(${storeyRefs.join(",")}))`
    )
  }

  return step.toString(model.name)
}

function quadAt(
  left: [Point, Point],
  right: [Point, Point],
  t0: number,
  t1: number
): [Point, Point, Point, Point] {
  const at = (pair: [Point, Point], t: number) => ({
    x: pair[0].x + (pair[1].x - pair[0].x) * t,
    y: pair[0].y + (pair[1].y - pair[0].y) * t,
  })
  return [at(left, t0), at(left, t1), at(right, t1), at(right, t0)]
}
