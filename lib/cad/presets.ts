/**
 * Standardverdier, norske etiketter og startkatalog for materialer.
 *
 * Tallene er alminnelige norske byggemål (TEK17-nære): 2,4 m romhøyde,
 * 198 cm dørhøyde, 10 cm bindingsverk innvendig / 25 cm yttervegg med isolasjon.
 * De er startpunkter — alt kan endres per element i editoren.
 */

import type {
  CadMaterial,
  MaterialCategory,
  OpeningKind,
  RoofKind,
  SlabKind,
  WallType,
} from "./types"

export const DEFAULTS = {
  storeyHeight: 2.4,
  exteriorWallThickness: 0.25,
  interiorWallThickness: 0.1,
  loadBearingWallThickness: 0.15,
  partitionThickness: 0.07,
  slabThickness: 0.2,
  roofThickness: 0.3,
  roofPitchDeg: 30,
  roofOverhang: 0.4,
  columnSize: 0.15,
  gridSize: 0.1,
  door: { width: 0.9, height: 2.0, sill: 0 },
  window: { width: 1.2, height: 1.2, sill: 0.9 },
  opening: { width: 1.0, height: 2.1, sill: 0 },
} as const

export const WALL_TYPE_LABELS: Record<WallType, string> = {
  exterior: "Yttervegg",
  interior: "Innervegg",
  load_bearing: "Bærevegg",
  partition: "Lettvegg",
}

export const WALL_TYPE_THICKNESS: Record<WallType, number> = {
  exterior: DEFAULTS.exteriorWallThickness,
  interior: DEFAULTS.interiorWallThickness,
  load_bearing: DEFAULTS.loadBearingWallThickness,
  partition: DEFAULTS.partitionThickness,
}

export const OPENING_LABELS: Record<OpeningKind, string> = {
  door: "Dør",
  window: "Vindu",
  opening: "Åpning",
}

export const SLAB_LABELS: Record<SlabKind, string> = {
  floor: "Gulv",
  ceiling: "Himling",
  deck: "Dekke",
  foundation: "Fundament/plate",
}

export const ROOF_LABELS: Record<RoofKind, string> = {
  flat: "Flatt tak",
  mono: "Pulttak",
  gable: "Saltak",
}

export const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  wall: "Vegg",
  floor: "Gulv",
  roof: "Tak",
  opening: "Dør/vindu",
  structure: "Konstruksjon",
  other: "Annet",
}

/** Farger i 3D-visningen når et element ikke har eget materiale. */
export const ELEMENT_COLORS = {
  exterior: "#d9d2c5",
  interior: "#e8e4dc",
  load_bearing: "#cfc7b7",
  partition: "#efece6",
  slab: "#b9b3a8",
  roof: "#8c8377",
  column: "#a89f92",
  glass: "#8fbcd4",
  door: "#a9743f",
  selection: "#2563eb",
  hover: "#60a5fa",
} as const

export function newId(prefix: string) {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}_${random}`
}

/**
 * Startkatalog. Bevisst kort: den skal dekke de vanligste flatene i et norsk
 * småhusprosjekt uten å drukne brukeren. Egne varer legges til fra prisfilene.
 */
export function createDefaultMaterials(): CadMaterial[] {
  const base = [
    {
      name: "Yttervegg – liggende kledning",
      category: "wall" as const,
      color: "#c8bda9",
      unit: "m2",
      measure: "area" as const,
      wastePercent: 10,
    },
    {
      name: "Innervegg – gipsplate 13 mm",
      category: "wall" as const,
      color: "#eeece7",
      unit: "m2",
      measure: "area" as const,
      wastePercent: 10,
    },
    {
      name: "Gulv – parkett eik",
      category: "floor" as const,
      color: "#c69b6d",
      unit: "m2",
      measure: "area" as const,
      wastePercent: 8,
    },
    {
      name: "Gulv – flis 60x60",
      category: "floor" as const,
      color: "#d7d3cc",
      unit: "m2",
      measure: "area" as const,
      wastePercent: 10,
    },
    {
      name: "Tak – takstein betong",
      category: "roof" as const,
      color: "#6f6a63",
      unit: "m2",
      measure: "area" as const,
      wastePercent: 8,
    },
    {
      name: "Vindu – 2-fags trelags",
      category: "opening" as const,
      color: "#8fbcd4",
      unit: "stk",
      measure: "count" as const,
      wastePercent: 0,
    },
    {
      name: "Innerdør – hvit slett",
      category: "opening" as const,
      color: "#b98a56",
      unit: "stk",
      measure: "count" as const,
      wastePercent: 0,
    },
  ]

  return base.map((item) => ({
    id: newId("mat"),
    name: item.name,
    category: item.category,
    color: item.color,
    unit: item.unit,
    measure: item.measure,
    factor: 1,
    wastePercent: item.wastePercent,
    supplier: null,
    nobb: null,
    supplierSku: null,
    unitPriceNok: null,
    notes: null,
  }))
}

export function defaultOpeningSize(kind: OpeningKind) {
  if (kind === "door") return DEFAULTS.door
  if (kind === "window") return DEFAULTS.window
  return DEFAULTS.opening
}

export function storeyName(index: number) {
  if (index === 0) return "1. etasje"
  return `${index + 1}. etasje`
}
