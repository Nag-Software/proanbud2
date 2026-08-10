/**
 * Mengdeuttrekk («takeoff») fra 3D-modellen.
 *
 * Dette er broen mellom tegningen og tilbudet: hver flate i modellen blir til
 * en mengde med enhet, og materialene brukeren har tilordnet flatene blir til
 * poster med svinn og eventuell enhetspris. Tallene regnes fra den PARAMETRISKE
 * modellen (senterlinjer, tykkelser, åpninger) — ikke fra mesh — så de er
 * eksakte og lar seg etterprøve.
 *
 * Regler som er tatt bevisst (og vist i UI):
 *  - Veggareal er NETTO: åpninger trekkes fra.
 *  - Innvendig overflate på en innervegg telles på begge sider, på en yttervegg
 *    kun innsiden.
 *  - Takareal er skrå areal (planareal / cos(takvinkel)), ikke projisert.
 *  - Romareal er innvendig mål (mellom veggenes innsider).
 */

import { expandOutline } from "./geometry"
import { degToRad, distance, polygonArea, polygonPerimeter } from "./math"
import { detectFaces } from "./rooms"
import type { BuildingModel, CadMaterial, Storey, Wall } from "./types"

export type TakeoffMeasure = "area" | "length" | "volume" | "count"

export type TakeoffLine = {
  id: string
  storeyId: string
  storeyName: string
  elementKind: "wall" | "opening" | "slab" | "roof" | "column" | "space"
  elementId: string
  label: string
  materialId: string | null
  materialName: string
  measure: TakeoffMeasure
  unit: string
  quantity: number
  wastePercent: number
  quantityWithWaste: number
  unitPriceNok: number | null
  totalNok: number | null
}

export type TakeoffMaterialGroup = {
  materialId: string
  materialName: string
  unit: string
  measure: TakeoffMeasure
  quantity: number
  quantityWithWaste: number
  wastePercent: number
  unitPriceNok: number | null
  totalNok: number | null
  supplier: string | null
  nobb: string | null
  elementCount: number
}

export type TakeoffRoom = {
  id: string
  name: string
  storeyName: string
  floorArea: number
  perimeter: number
  wallArea: number
  ceilingArea: number
}

export type TakeoffTotals = {
  grossFloorArea: number
  exteriorWallArea: number
  interiorWallArea: number
  wallVolume: number
  wallLength: number
  roofArea: number
  slabArea: number
  doorCount: number
  windowCount: number
  storeyCount: number
  roomCount: number
}

export type TakeoffResult = {
  totals: TakeoffTotals
  lines: TakeoffLine[]
  materials: TakeoffMaterialGroup[]
  rooms: TakeoffRoom[]
  /** Poster uten tilordnet materiale — vises som «mangler valg» i UI. */
  unassignedCount: number
}

function openingArea(wall: Wall) {
  return wall.openings.reduce((sum, opening) => sum + opening.width * opening.height, 0)
}

function wallNetArea(wall: Wall) {
  const gross = distance(wall.a, wall.b) * wall.height
  return Math.max(gross - openingArea(wall), 0)
}

function roofSlopeFactor(pitchDeg: number) {
  const clamped = Math.min(Math.max(pitchDeg, 0), 80)
  return 1 / Math.cos(degToRad(clamped))
}

function round(value: number, decimals = 2) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function computeTakeoff(model: BuildingModel): TakeoffResult {
  const materialsById = new Map<string, CadMaterial>(
    model.materials.map((material) => [material.id, material])
  )
  const lines: TakeoffLine[] = []
  const rooms: TakeoffRoom[] = []

  const totals: TakeoffTotals = {
    grossFloorArea: 0,
    exteriorWallArea: 0,
    interiorWallArea: 0,
    wallVolume: 0,
    wallLength: 0,
    roofArea: 0,
    slabArea: 0,
    doorCount: 0,
    windowCount: 0,
    storeyCount: model.storeys.length,
    roomCount: 0,
  }

  let unassignedCount = 0

  const pushLine = (input: {
    storey: Storey
    elementKind: TakeoffLine["elementKind"]
    elementId: string
    label: string
    materialId: string | null | undefined
    quantityByMeasure: Partial<Record<TakeoffMeasure, number>>
    idSuffix?: string
  }) => {
    const material = input.materialId ? materialsById.get(input.materialId) : undefined
    if (!material) {
      unassignedCount += 1
      return
    }

    const raw = input.quantityByMeasure[material.measure]
    if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return

    const quantity = raw * (material.factor || 1)
    const quantityWithWaste = quantity * (1 + (material.wastePercent || 0) / 100)
    const unitPriceNok = material.unitPriceNok ?? null

    lines.push({
      id: `${input.elementId}:${material.id}${input.idSuffix ? `:${input.idSuffix}` : ""}`,
      storeyId: input.storey.id,
      storeyName: input.storey.name,
      elementKind: input.elementKind,
      elementId: input.elementId,
      label: input.label,
      materialId: material.id,
      materialName: material.name,
      measure: material.measure,
      unit: material.unit,
      quantity: round(quantity, 3),
      wastePercent: material.wastePercent || 0,
      quantityWithWaste: round(quantityWithWaste, 3),
      unitPriceNok,
      totalNok: unitPriceNok === null ? null : round(quantityWithWaste * unitPriceNok, 2),
    })
  }

  for (const storey of model.storeys) {
    const faces = detectFaces(storey.walls)
    const wallsById = new Map(storey.walls.map((wall) => [wall.id, wall]))

    for (const wall of storey.walls) {
      const length = distance(wall.a, wall.b)
      const netArea = wallNetArea(wall)
      const volume = netArea * wall.thickness
      const isExterior = wall.type === "exterior"

      totals.wallLength += length
      totals.wallVolume += volume
      if (isExterior) totals.exteriorWallArea += netArea
      else totals.interiorWallArea += netArea

      for (const opening of wall.openings) {
        if (opening.kind === "door") totals.doorCount += 1
        if (opening.kind === "window") totals.windowCount += 1
      }

      const label = wall.label || `${isExterior ? "Yttervegg" : "Innervegg"} ${round(length, 1)} m`

      pushLine({
        storey,
        elementKind: "wall",
        elementId: wall.id,
        label,
        materialId: wall.materialId,
        quantityByMeasure: { area: netArea, length, volume },
      })

      pushLine({
        storey,
        elementKind: "wall",
        elementId: wall.id,
        label: `${label} – utvendig`,
        materialId: wall.exteriorMaterialId,
        quantityByMeasure: { area: netArea, length, volume },
        idSuffix: "ext",
      })

      // Innvendig overflate: begge sider på innervegg, kun innsiden på yttervegg.
      const interiorSides = isExterior ? 1 : 2
      pushLine({
        storey,
        elementKind: "wall",
        elementId: wall.id,
        label: `${label} – innvendig`,
        materialId: wall.interiorMaterialId,
        quantityByMeasure: {
          area: netArea * interiorSides,
          length,
          volume,
        },
        idSuffix: "int",
      })

      for (const opening of wall.openings) {
        pushLine({
          storey,
          elementKind: "opening",
          elementId: opening.id,
          label:
            opening.label ||
            `${opening.kind === "door" ? "Dør" : opening.kind === "window" ? "Vindu" : "Åpning"} ${Math.round(
              opening.width * 1000
            )}×${Math.round(opening.height * 1000)}`,
          materialId: opening.materialId,
          quantityByMeasure: {
            count: 1,
            area: opening.width * opening.height,
            length: (opening.width + opening.height) * 2,
          },
        })
      }
    }

    for (const slab of storey.slabs) {
      const area = polygonArea(slab.outline)
      totals.slabArea += area
      if (slab.kind === "floor" || slab.kind === "foundation") totals.grossFloorArea += area

      pushLine({
        storey,
        elementKind: "slab",
        elementId: slab.id,
        label: slab.label || `Dekke ${round(area, 1)} m²`,
        materialId: slab.materialId,
        quantityByMeasure: {
          area,
          volume: area * slab.thickness,
          length: polygonPerimeter(slab.outline),
        },
      })
    }

    for (const roof of storey.roofs) {
      // Utstikket tekkes også — det skal med i mengden man bestiller stein til.
      const coverage = roof.overhang > 0 ? expandOutline(roof.outline, roof.overhang) : roof.outline
      const planArea = polygonArea(coverage)
      const area = planArea * roofSlopeFactor(roof.kind === "flat" ? 0 : roof.pitchDeg)
      totals.roofArea += area

      pushLine({
        storey,
        elementKind: "roof",
        elementId: roof.id,
        label: roof.label || `Tak ${round(area, 1)} m²`,
        materialId: roof.materialId,
        quantityByMeasure: {
          area,
          volume: area * roof.thickness,
          length: polygonPerimeter(roof.outline),
        },
      })
    }

    for (const column of storey.columns) {
      pushLine({
        storey,
        elementKind: "column",
        elementId: column.id,
        label: column.label || "Søyle",
        materialId: column.materialId,
        quantityByMeasure: {
          count: 1,
          length: column.height,
          volume: column.width * column.depth * column.height,
        },
      })
    }

    for (const space of storey.spaces) {
      const floorArea = polygonArea(space.outline)
      const perimeter = polygonPerimeter(space.outline)
      totals.roomCount += 1

      // Åpninger i veggene som grenser til rommet trekkes fra veggflaten.
      const face = faces.find(
        (candidate) =>
          Math.abs(polygonArea(candidate.inner) - floorArea) < Math.max(floorArea * 0.05, 0.2)
      )
      const boundaryOpeningArea = (face?.wallIds ?? [])
        .map((wallId) => wallsById.get(wallId))
        .filter((wall): wall is Wall => Boolean(wall))
        .reduce((sum, wall) => sum + openingArea(wall), 0)

      const wallArea = Math.max(perimeter * storey.height - boundaryOpeningArea, 0)

      rooms.push({
        id: space.id,
        name: space.name,
        storeyName: storey.name,
        floorArea: round(floorArea, 2),
        perimeter: round(perimeter, 2),
        wallArea: round(wallArea, 2),
        ceilingArea: round(floorArea, 2),
      })

      pushLine({
        storey,
        elementKind: "space",
        elementId: space.id,
        label: `${space.name} – gulv`,
        materialId: space.floorMaterialId,
        quantityByMeasure: { area: floorArea, length: perimeter, count: 1 },
        idSuffix: "floor",
      })

      pushLine({
        storey,
        elementKind: "space",
        elementId: space.id,
        label: `${space.name} – vegger`,
        materialId: space.wallMaterialId,
        quantityByMeasure: { area: wallArea, length: perimeter, count: 1 },
        idSuffix: "wall",
      })

      pushLine({
        storey,
        elementKind: "space",
        elementId: space.id,
        label: `${space.name} – himling`,
        materialId: space.ceilingMaterialId,
        quantityByMeasure: { area: floorArea, length: perimeter, count: 1 },
        idSuffix: "ceiling",
      })
    }

    // Uten gulvdekke bruker vi rommene som grunnflate, slik at BRA aldri blir 0.
    if (storey.slabs.every((slab) => slab.kind !== "floor" && slab.kind !== "foundation")) {
      totals.grossFloorArea += storey.spaces.reduce(
        (sum, space) => sum + polygonArea(space.outline),
        0
      )
    }
  }

  const groups = new Map<string, TakeoffMaterialGroup>()
  for (const line of lines) {
    if (!line.materialId) continue
    const material = materialsById.get(line.materialId)
    const existing = groups.get(line.materialId)
    if (existing) {
      existing.quantity = round(existing.quantity + line.quantity, 3)
      existing.quantityWithWaste = round(existing.quantityWithWaste + line.quantityWithWaste, 3)
      existing.elementCount += 1
      existing.totalNok =
        existing.unitPriceNok === null ? null : round(existing.quantityWithWaste * existing.unitPriceNok, 2)
      continue
    }
    groups.set(line.materialId, {
      materialId: line.materialId,
      materialName: line.materialName,
      unit: line.unit,
      measure: line.measure,
      quantity: line.quantity,
      quantityWithWaste: line.quantityWithWaste,
      wastePercent: line.wastePercent,
      unitPriceNok: line.unitPriceNok,
      totalNok: line.totalNok,
      supplier: material?.supplier ?? null,
      nobb: material?.nobb ?? null,
      elementCount: 1,
    })
  }

  return {
    totals: {
      ...totals,
      grossFloorArea: round(totals.grossFloorArea, 2),
      exteriorWallArea: round(totals.exteriorWallArea, 2),
      interiorWallArea: round(totals.interiorWallArea, 2),
      wallVolume: round(totals.wallVolume, 3),
      wallLength: round(totals.wallLength, 2),
      roofArea: round(totals.roofArea, 2),
      slabArea: round(totals.slabArea, 2),
    },
    lines,
    materials: [...groups.values()].sort((left, right) =>
      left.materialName.localeCompare(right.materialName, "nb")
    ),
    rooms,
    unassignedCount,
  }
}

function formatNumber(value: number, decimals = 1) {
  return value.toFixed(decimals).replace(".", ",")
}

/**
 * Kompakt tekstblokk til tilbuds-KI-en. Holdes bevisst kort — den konkurrerer
 * om tegnbudsjettet med prisfilene (jf. 240k-grensen i ai-chat).
 */
export function formatTakeoffForPrompt(model: BuildingModel, takeoff: TakeoffResult) {
  const lines: string[] = []

  lines.push(`Modell: ${model.name}`)
  lines.push(
    [
      `Etasjer: ${takeoff.totals.storeyCount}`,
      `BRA ca. ${formatNumber(takeoff.totals.grossFloorArea)} m²`,
      `Rom: ${takeoff.totals.roomCount}`,
    ].join(" | ")
  )
  lines.push(
    [
      `Yttervegg netto ${formatNumber(takeoff.totals.exteriorWallArea)} m²`,
      `innervegg netto ${formatNumber(takeoff.totals.interiorWallArea)} m²`,
      `veggvolum ${formatNumber(takeoff.totals.wallVolume, 2)} m³`,
      `tak ${formatNumber(takeoff.totals.roofArea)} m² (skrå areal)`,
      `dekke ${formatNumber(takeoff.totals.slabArea)} m²`,
    ].join(", ")
  )
  lines.push(`Dører: ${takeoff.totals.doorCount} | Vinduer: ${takeoff.totals.windowCount}`)

  if (takeoff.rooms.length > 0) {
    lines.push("")
    lines.push("Rom (innvendig mål):")
    for (const room of takeoff.rooms.slice(0, 30)) {
      lines.push(
        `- ${room.name} (${room.storeyName}): gulv ${formatNumber(room.floorArea)} m², vegg ${formatNumber(
          room.wallArea
        )} m², omkrets ${formatNumber(room.perimeter)} m`
      )
    }
  }

  if (takeoff.materials.length > 0) {
    lines.push("")
    lines.push("Materialer valgt på modellen (mengde inkl. svinn):")
    for (const group of takeoff.materials.slice(0, 40)) {
      const price = group.unitPriceNok !== null ? `, enhetspris ${group.unitPriceNok} kr` : ""
      const supplier = group.supplier ? `, leverandør ${group.supplier}` : ""
      const nobb = group.nobb ? `, NOBB ${group.nobb}` : ""
      lines.push(
        `- ${group.materialName}: ${formatNumber(group.quantityWithWaste, 2)} ${group.unit}${supplier}${nobb}${price}`
      )
    }
  }

  return lines.join("\n")
}
