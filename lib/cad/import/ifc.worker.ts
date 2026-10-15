/// <reference lib="webworker" />
/**
 * Leser IFC-filer i en egen tråd, så siden ikke fryser mens en stor modell
 * tolkes (det kan ta flere sekunder). Bruker web-ifc (wasm, lastet fra
 * /web-ifc/ — se scripts/copy-web-ifc-wasm.mjs).
 *
 * Geometrien slås sammen per farge (lib/cad/import/geometri.ts) og sendes
 * tilbake uten kopiering. Modellen holdes åpen, så et trykk på et element kan
 * hente navn, egenskaper og mengder fra IFC-fila.
 */

import { IfcAPI } from "web-ifc"

import { overforbare, type ImportGeometri } from "./geometri"
import { tekst, tolkIfc } from "./ifc-tolk"

export type IfcForesporsel =
  | { type: "les"; data: ArrayBuffer }
  | { type: "info"; expressId: number }

export type IfcEgenskap = { navn: string; verdi: string }
export type IfcEgenskapsgruppe = { navn: string; egenskaper: IfcEgenskap[] }

export type IfcSvar =
  | { type: "fremdrift"; andel: number }
  | { type: "ferdig"; geometri: ImportGeometri }
  | { type: "info"; expressId: number; grupper: IfcEgenskapsgruppe[] }
  | { type: "feil"; melding: string }

const api = new IfcAPI()
let klar: Promise<void> | null = null
let modellId: number | null = null

const scope = self as unknown as DedicatedWorkerGlobalScope

function svar(melding: IfcSvar, overfor: ArrayBuffer[] = []) {
  scope.postMessage(melding, overfor)
}

async function init() {
  if (!klar) {
    api.SetWasmPath("/web-ifc/", true)
    // Én tråd: flertråds-wasm krever SharedArrayBuffer (COOP/COEP-hoder), som
    // appen ikke har — og trengs ikke for modeller i denne størrelsen.
    klar = api.Init(undefined, true)
  }
  return klar
}

async function les(data: ArrayBuffer) {
  await init()
  if (modellId !== null) {
    api.CloseModel(modellId)
    modellId = null
  }
  const id = api.OpenModel(new Uint8Array(data), {
    // Georefererte modeller ligger ofte millioner av meter fra origo; da
    // flimrer geometrien (float-presisjon). Flytt til origo.
    COORDINATE_TO_ORIGIN: true,
  })
  if (id < 0) throw new Error("IFC-fila kunne ikke åpnes. Den kan være skadet eller i et format web-ifc ikke leser.")
  modellId = id
  const geometri = tolkIfc(api, id, (andel) => svar({ type: "fremdrift", andel }))
  svar({ type: "ferdig", geometri }, overforbare(geometri))
}

async function info(expressId: number) {
  if (modellId === null) {
    svar({ type: "info", expressId, grupper: [] })
    return
  }
  const grupper: IfcEgenskapsgruppe[] = []
  try {
    const linje = api.GetLine(modellId, expressId)
    const grunn: IfcEgenskap[] = []
    const navn = tekst(linje?.Name)
    if (navn) grunn.push({ navn: "Navn", verdi: navn })
    const objekttype = tekst(linje?.ObjectType)
    if (objekttype) grunn.push({ navn: "Type", verdi: objekttype })
    const beskrivelse = tekst(linje?.Description)
    if (beskrivelse) grunn.push({ navn: "Beskrivelse", verdi: beskrivelse })
    const tag = tekst(linje?.Tag)
    if (tag) grunn.push({ navn: "Merke", verdi: tag })
    if (grunn.length) grupper.push({ navn: "Element", egenskaper: grunn })

    const sett = await api.properties.getPropertySets(modellId, expressId, true, true)
    for (const s of sett.slice(0, 12)) {
      const egenskaper: IfcEgenskap[] = []
      for (const p of [...(s?.HasProperties ?? []), ...(s?.Quantities ?? [])].slice(0, 40)) {
        const pNavn = tekst(p?.Name)
        const verdi =
          tekst(p?.NominalValue) ||
          tekst(p?.LengthValue) ||
          tekst(p?.AreaValue) ||
          tekst(p?.VolumeValue) ||
          tekst(p?.CountValue) ||
          tekst(p?.WeightValue)
        if (pNavn && verdi) egenskaper.push({ navn: pNavn, verdi })
      }
      if (egenskaper.length) grupper.push({ navn: tekst(s?.Name) || "Egenskaper", egenskaper })
    }
  } catch {
    // Egenskaper er en bonus; uten dem viser vi bare mål fra geometrien.
  }
  svar({ type: "info", expressId, grupper })
}

scope.onmessage = (event: MessageEvent<IfcForesporsel>) => {
  const melding = event.data
  const jobb = melding.type === "les" ? les(melding.data) : info(melding.expressId)
  jobb.catch((error: unknown) => {
    svar({
      type: "feil",
      melding: error instanceof Error ? error.message : "IFC-fila kunne ikke leses.",
    })
  })
}
