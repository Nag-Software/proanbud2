import type { ImportFormat } from "../types"

/**
 * Filformatene 3D-modellen kan importere.
 *
 * 3D-filer vises som eget lag i 3D. Tegninger legges under plantegningen.
 * Formater uten åpen leser i nettleseren (DWG, RVT, SKP, PLN) står i
 * `IKKE_STOTTET` med hva man eksporterer til i stedet, så brukeren får et
 * svar i stedet for en feil.
 */
export type FormatInfo = {
  format: ImportFormat
  kind: "model" | "drawing"
  /** Kort navn til lister. */
  label: string
  /** Hvor fila typisk kommer fra. */
  from: string
  extensions: string[]
  /**
   * Enhet i fila når formatet selv sier det (IFC og glTF er i meter). Null =
   * formatet har ingen fast enhet; vi gjetter ut fra størrelsen og lar
   * brukeren rette.
   */
  fixedScale: number | null
  /** Vanlig opp-akse i fila. */
  upAxis: "y" | "z"
}

export const IMPORT_FORMATS: FormatInfo[] = [
  { format: "ifc", kind: "model", label: "IFC", from: "Revit, ArchiCAD, Tekla, Solibri", extensions: ["ifc"], upAxis: "y", fixedScale: 1 },
  { format: "glb", kind: "model", label: "GLB", from: "SketchUp, Blender, de fleste 3D-program", extensions: ["glb"], upAxis: "y", fixedScale: 1 },
  { format: "gltf", kind: "model", label: "glTF", from: "Blender, 3D-program (én fil)", extensions: ["gltf"], upAxis: "y", fixedScale: 1 },
  { format: "obj", kind: "model", label: "OBJ", from: "SketchUp, Blender, Rhino", extensions: ["obj"], upAxis: "y", fixedScale: null },
  { format: "fbx", kind: "model", label: "FBX", from: "Revit, 3ds Max, SketchUp", extensions: ["fbx"], upAxis: "y", fixedScale: null },
  { format: "dae", kind: "model", label: "DAE (Collada)", from: "SketchUp", extensions: ["dae"], upAxis: "y", fixedScale: null },
  { format: "kmz", kind: "model", label: "KMZ", from: "SketchUp, Google Earth", extensions: ["kmz"], upAxis: "y", fixedScale: null },
  { format: "stl", kind: "model", label: "STL", from: "Rhino, Fusion, 3D-print", extensions: ["stl"], upAxis: "z", fixedScale: null },
  { format: "3ds", kind: "model", label: "3DS", from: "3ds Max, eldre program", extensions: ["3ds"], upAxis: "y", fixedScale: null },
  { format: "3mf", kind: "model", label: "3MF", from: "Fusion, Rhino", extensions: ["3mf"], upAxis: "z", fixedScale: null },
  { format: "ply", kind: "model", label: "PLY", from: "Skanning, punktsky-program", extensions: ["ply"], upAxis: "z", fixedScale: null },
  { format: "wrl", kind: "model", label: "VRML", from: "Eldre CAD-program", extensions: ["wrl", "vrml"], upAxis: "y", fixedScale: null },
  { format: "dxf", kind: "drawing", label: "DXF", from: "AutoCAD, Revit, ArchiCAD (plantegning)", extensions: ["dxf"], upAxis: "y", fixedScale: null },
  { format: "pdf", kind: "drawing", label: "PDF", from: "Arkitekttegninger", extensions: ["pdf"], upAxis: "y", fixedScale: null },
  { format: "png", kind: "drawing", label: "PNG", from: "Skjermbilde, skannet tegning", extensions: ["png"], upAxis: "y", fixedScale: null },
  { format: "jpg", kind: "drawing", label: "JPG", from: "Bilde av tegning", extensions: ["jpg", "jpeg"], upAxis: "y", fixedScale: null },
]

/** Formater nettleseren ikke kan lese, med hva man eksporterer til i stedet. */
export const IKKE_STOTTET: Record<string, string> = {
  dwg: "DWG kan ikke leses i nettleseren. Lagre som DXF i AutoCAD (Lagre som → DXF) og importer den.",
  rvt: "Revit-filer kan ikke leses direkte. Eksporter til IFC i Revit (Fil → Eksporter → IFC).",
  rfa: "Revit-familier kan ikke leses direkte. Eksporter prosjektet til IFC.",
  skp: "SketchUp-filer kan ikke leses direkte. Eksporter til DAE eller GLB i SketchUp (Fil → Eksporter → 3D-modell).",
  pln: "ArchiCAD-filer kan ikke leses direkte. Lagre som IFC i ArchiCAD.",
  "3dm": "Rhino-filer kan ikke leses direkte. Eksporter til OBJ, STL eller IFC.",
  nwd: "Navisworks-filer kan ikke leses direkte. Eksporter til FBX eller IFC.",
  step: "STEP-filer støttes ikke. Eksporter til STL, OBJ eller IFC.",
  stp: "STEP-filer støttes ikke. Eksporter til STL, OBJ eller IFC.",
}

/** Største fil (bytes). Samme grense som storage-bøtta (db/117). */
export const MAKS_FILSTORRELSE = 100 * 1024 * 1024

export function fileExtension(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim())
  return match ? match[1].toLowerCase() : ""
}

export function formatForFile(name: string): FormatInfo | null {
  const extension = fileExtension(name)
  return IMPORT_FORMATS.find((info) => info.extensions.includes(extension)) ?? null
}

export function formatInfo(format: ImportFormat): FormatInfo {
  return IMPORT_FORMATS.find((info) => info.format === format) ?? IMPORT_FORMATS[0]
}

/** `accept` til filvelgeren. */
export const IMPORT_ACCEPT = IMPORT_FORMATS.flatMap((info) => info.extensions.map((extension) => `.${extension}`)).join(",")

export type FilSjekk = { ok: true; info: FormatInfo } | { ok: false; error: string }

/** Sjekker fila før opplasting: format og størrelse, med svar brukeren kan handle på. */
export function sjekkFil(name: string, sizeBytes: number): FilSjekk {
  const extension = fileExtension(name)
  const info = formatForFile(name)
  if (!info) {
    const hint = IKKE_STOTTET[extension]
    return {
      ok: false,
      error: hint ?? `Filtypen ${extension ? `.${extension}` : "uten endelse"} støttes ikke.`,
    }
  }
  if (sizeBytes > MAKS_FILSTORRELSE) {
    return { ok: false, error: `Fila er ${formatMb(sizeBytes)}. Grensen er ${formatMb(MAKS_FILSTORRELSE)}.` }
  }
  if (sizeBytes === 0) return { ok: false, error: "Fila er tom." }
  return { ok: true, info }
}

export function formatMb(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`
  const mb = bytes / (1024 * 1024)
  return `${mb < 10 ? mb.toLocaleString("nb-NO", { maximumFractionDigits: 1 }) : Math.round(mb)} MB`
}

/**
 * Gjetter enheten i en fil uten fast enhet ut fra hvor stor modellen er.
 * Et bygg er sjelden over 300 m eller under 1 m: er største mål over 1000,
 * er fila nesten sikkert i millimeter; over 300, i centimeter.
 */
export function gjettSkala(storsteMal: number): number {
  if (!Number.isFinite(storsteMal) || storsteMal <= 0) return 1
  if (storsteMal > 1000) return 0.001
  if (storsteMal > 300) return 0.01
  return 1
}

export const SKALA_VALG: Array<{ verdi: number; navn: string }> = [
  { verdi: 0.001, navn: "Millimeter" },
  { verdi: 0.01, navn: "Centimeter" },
  { verdi: 1, navn: "Meter" },
  { verdi: 0.0254, navn: "Tommer" },
  { verdi: 0.3048, navn: "Fot" },
]
