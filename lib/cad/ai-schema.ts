/**
 * KI-skissen: mellomformatet mellom språkmodellen og bygningsmodellen.
 *
 * Modellen blir IKKE bedt om å skrive den interne JSON-strukturen direkte.
 * Den er full av id-er, kryssreferanser og avledede felt som en språkmodell
 * uunngåelig roter til. I stedet ber vi om noe den er god på — et omriss,
 * noen skilleveggstrekk, og «sett et vindu her» som et punkt — og bygger den
 * strenge modellen selv.
 *
 * Åpninger og romnavn oppgis som PUNKTER i planet, ikke som «vegg nr. 3,
 * 2,4 m fra start». Punktet snappes til nærmeste vegg her. Det fjerner hele
 * klassen av feil der modellen teller vegger feil.
 */

import { z } from "zod"

import { closestPointOnSegment, dedupePolygon, distance, polygonArea, signedArea } from "./math"
import { DEFAULTS, createDefaultMaterials, newId, storeyName } from "./presets"
import { syncSpaces } from "./rooms"
import { sanitizeModel } from "./schema"
import type { BuildingModel, Opening, Point, Roof, Slab, Storey, Wall } from "./types"

const pointSchema = z.object({ x: z.number(), y: z.number() })

const aiOpeningSchema = z.object({
  kind: z.enum(["door", "window", "opening"]),
  at: pointSchema,
  widthM: z.number().min(0.2).max(20),
  heightM: z.number().min(0.2).max(6),
  sillM: z.number().min(0).max(5).default(0),
  label: z.string().max(80).optional(),
})

const aiWallSchema = z.object({
  a: pointSchema,
  b: pointSchema,
  thicknessM: z.number().min(0.03).max(1.5).optional(),
  type: z.enum(["interior", "load_bearing", "partition"]).optional(),
})

const aiStoreySchema = z.object({
  name: z.string().max(60).optional(),
  elevationM: z.number().min(-20).max(100).optional(),
  heightM: z.number().min(1.5).max(8).optional(),
  outline: z.array(pointSchema).min(3).max(60),
  exteriorWallThicknessM: z.number().min(0.05).max(1.5).optional(),
  interiorWalls: z.array(aiWallSchema).max(120).default([]),
  openings: z.array(aiOpeningSchema).max(120).default([]),
  rooms: z
    .array(z.object({ name: z.string().max(60), at: pointSchema }))
    .max(60)
    .default([]),
  hasFloorSlab: z.boolean().default(true),
})

const aiRoofSchema = z.object({
  kind: z.enum(["flat", "mono", "gable"]),
  pitchDeg: z.number().min(0).max(70).default(30),
  directionDeg: z.number().min(-360).max(360).default(0),
  overhangM: z.number().min(0).max(3).default(0.4),
})

export const aiSketchSchema = z.object({
  name: z.string().max(120).optional(),
  summary: z.string().max(600).optional(),
  assumptions: z.array(z.string().max(300)).max(20).default([]),
  storeys: z.array(aiStoreySchema).min(1).max(6),
  roof: aiRoofSchema.nullish(),
})

export type AiSketch = z.infer<typeof aiSketchSchema>

/**
 * Beskrivelsen av skisseformatet som sendes til modellen. Holdt kort og
 * eksempeldrevet — lange regellister gir dårligere geometri enn ett godt
 * eksempel pluss noen få harde krav.
 */
export const AI_SKETCH_FORMAT = JSON.stringify({
  name: "Tilbygg Storgata 4",
  summary: "Ett plan på 8 × 6 m med saltak, delt i stue, bad og gang.",
  assumptions: [
    "Antatt 2,4 m romhøyde – ikke oppgitt i beskrivelsen",
    "Vindusplassering er anslått fra bildene",
  ],
  storeys: [
    {
      name: "1. etasje",
      elevationM: 0,
      heightM: 2.4,
      outline: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 6 },
        { x: 0, y: 6 },
      ],
      exteriorWallThicknessM: 0.25,
      interiorWalls: [{ a: { x: 5, y: 0 }, b: { x: 5, y: 6 }, thicknessM: 0.1, type: "interior" }],
      openings: [
        { kind: "door", at: { x: 2, y: 0 }, widthM: 1, heightM: 2.1, sillM: 0, label: "Ytterdør" },
        { kind: "window", at: { x: 6, y: 0 }, widthM: 1.2, heightM: 1.2, sillM: 0.9 },
      ],
      rooms: [
        { name: "Stue", at: { x: 2.5, y: 3 } },
        { name: "Bad", at: { x: 6.5, y: 3 } },
      ],
      hasFloorSlab: true,
    },
  ],
  roof: { kind: "gable", pitchDeg: 30, directionDeg: 0, overhangM: 0.4 },
})

// ---------------------------------------------------------------------------
// Skisse → bygningsmodell
// ---------------------------------------------------------------------------

function wallTypeThickness(type: Wall["type"], override?: number) {
  if (override && override > 0) return override
  if (type === "exterior") return DEFAULTS.exteriorWallThickness
  if (type === "load_bearing") return DEFAULTS.loadBearingWallThickness
  if (type === "partition") return DEFAULTS.partitionThickness
  return DEFAULTS.interiorWallThickness
}

/** Fester en åpning til den veggen den ligger nærmest. */
function attachOpening(walls: Wall[], opening: z.infer<typeof aiOpeningSchema>) {
  let bestWall: Wall | null = null
  let bestDistance = Infinity
  let bestAlong = 0

  for (const wall of walls) {
    const projection = closestPointOnSegment(opening.at, wall.a, wall.b)
    if (projection.distance < bestDistance) {
      bestDistance = projection.distance
      bestWall = wall
      bestAlong = projection.t * distance(wall.a, wall.b)
    }
  }

  // Ligger punktet langt fra alle vegger, er det sannsynligvis en misforståelse
  // hos modellen. Da dropper vi åpningen heller enn å tvinge den inn et
  // tilfeldig sted.
  if (!bestWall || bestDistance > 1.5) return null

  const built: Opening = {
    id: newId("op"),
    kind: opening.kind,
    distance: bestAlong,
    width: opening.widthM,
    height: opening.heightM,
    sill: opening.kind === "door" ? 0 : opening.sillM,
    label: opening.label ?? null,
    materialId: null,
  }

  return { wallId: bestWall.id, opening: built }
}

export function buildingModelFromSketch(
  sketch: AiSketch,
  options: { fallbackName?: string; modelUsed?: string } = {}
): BuildingModel {
  const storeys: Storey[] = []

  sketch.storeys.forEach((sketchStorey, index) => {
    const height = sketchStorey.heightM ?? DEFAULTS.storeyHeight
    // Omrisset holdes mot klokka slik at gjæring og romdeteksjon får riktig
    // fortegn uansett hva modellen fant på.
    // KI-en gjentar gjerne startpunktet til slutt. Ryddes før noe annet, ellers
    // arver både vegger, gulv og tak et hjørne uten retning.
    const cleaned = dedupePolygon(sketchStorey.outline)
    const outline = signedArea(cleaned) < 0 ? [...cleaned].reverse() : cleaned

    const exteriorThickness = wallTypeThickness("exterior", sketchStorey.exteriorWallThicknessM)

    const walls: Wall[] = []

    for (let i = 0; i < outline.length; i++) {
      const a = outline[i]
      const b = outline[(i + 1) % outline.length]
      if (distance(a, b) < 0.05) continue
      walls.push({
        id: newId("w"),
        a,
        b,
        thickness: exteriorThickness,
        height,
        baseOffset: 0,
        type: "exterior",
        openings: [],
        materialId: null,
        exteriorMaterialId: null,
        interiorMaterialId: null,
        label: null,
      })
    }

    for (const interior of sketchStorey.interiorWalls) {
      if (distance(interior.a, interior.b) < 0.05) continue
      const type = interior.type ?? "interior"
      walls.push({
        id: newId("w"),
        a: interior.a,
        b: interior.b,
        thickness: wallTypeThickness(type, interior.thicknessM),
        height,
        baseOffset: 0,
        type,
        openings: [],
        materialId: null,
        exteriorMaterialId: null,
        interiorMaterialId: null,
        label: null,
      })
    }

    for (const sketchOpening of sketchStorey.openings) {
      const attached = attachOpening(walls, sketchOpening)
      if (!attached) continue
      const wall = walls.find((item) => item.id === attached.wallId)
      if (wall) wall.openings.push(attached.opening)
    }

    const slabs: Slab[] = sketchStorey.hasFloorSlab
      ? [
          {
            id: newId("sl"),
            kind: index === 0 ? "foundation" : "deck",
            outline,
            thickness: DEFAULTS.slabThickness,
            offset: 0,
            materialId: null,
            label: null,
          },
        ]
      : []

    const roofs: Roof[] = []
    const isTopStorey = index === sketch.storeys.length - 1
    if (isTopStorey && sketch.roof) {
      roofs.push({
        id: newId("rf"),
        kind: sketch.roof.kind,
        outline,
        baseHeight: height,
        pitchDeg: sketch.roof.kind === "flat" ? 0 : sketch.roof.pitchDeg,
        directionDeg: sketch.roof.directionDeg,
        thickness: DEFAULTS.roofThickness,
        overhang: sketch.roof.overhangM,
        materialId: null,
        label: null,
      })
    }

    const storey: Storey = {
      id: newId("st"),
      name: sketchStorey.name || storeyName(index),
      elevation: sketchStorey.elevationM ?? cumulativeElevation(sketch, index),
      height,
      walls,
      slabs,
      roofs,
      columns: [],
      spaces: [],
      visible: true,
    }

    // Finn rommene av modellen selv, og gi dem navnene KI-en foreslo.
    storey.spaces = syncSpaces(storey.walls, []).map((space) => {
      const named = sketchStorey.rooms.find((room) => pointInsideOutline(room.at, space.outline))
      return named ? { ...space, name: named.name } : space
    })

    storeys.push(storey)
  })

  const model: BuildingModel = {
    schemaVersion: 1,
    name: sketch.name || options.fallbackName || "3D-modell",
    units: "m",
    storeys,
    materials: createDefaultMaterials(),
    meta: {
      gridSize: DEFAULTS.gridSize,
      northAngleDeg: 0,
      notes: sketch.summary ?? null,
      source: "ai",
      generatedAt: new Date().toISOString(),
      generatedModel: options.modelUsed ?? null,
      assumptions: sketch.assumptions,
    },
  }

  return sanitizeModel(model)
}

function cumulativeElevation(sketch: AiSketch, index: number) {
  let elevation = 0
  for (let i = 0; i < index; i++) {
    elevation += sketch.storeys[i].heightM ?? DEFAULTS.storeyHeight
  }
  return elevation
}

function pointInsideOutline(point: Point, outline: Point[]) {
  if (outline.length < 3 || polygonArea(outline) < 0.05) return false
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const a = outline[i]
    const b = outline[j]
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    if (intersects) inside = !inside
  }
  return inside
}
