/**
 * Laster en importert 3D-fil og gjør den om til ImportGeometri (se geometri.ts).
 *
 *  - IFC leses i en egen arbeidertråd (ifc.worker.ts), som holdes i live så
 *    trykk på et element kan hente egenskaper.
 *  - Alt annet leses med three.js sine egne lesere. Hver leser lastes først når
 *    noen faktisk åpner en fil av den typen.
 *  - Fila hentes én gang og legges i nettleserens Cache API (stien har en
 *    UUID, så innholdet endrer seg aldri). Neste gang åpnes modellen uten
 *    nedlasting.
 *
 * Bare for nettleseren.
 */

import type * as THREE from "three"

import type { ImportFormat } from "../types"
import { slaSammen, type GeometriDel, type ImportElement, type ImportGeometri } from "./geometri"
import type { IfcEgenskapsgruppe, IfcSvar } from "./ifc.worker"

const CACHE_NAVN = "proanbud-modellfiler-v1"

const cacheNokkel = (storagePath: string) => `https://cache.proanbud.local/${encodeURIComponent(storagePath)}`

/** Legger en fil vi nettopp lastet opp i hurtigbufferen, så den ikke lastes ned igjen. */
export async function leggIHurtigbuffer(storagePath: string, data: ArrayBuffer) {
  try {
    if (typeof caches === "undefined") return
    const cache = await caches.open(CACHE_NAVN)
    await cache.put(cacheNokkel(storagePath), new Response(data.slice(0)))
  } catch {
    // Ikke kritisk.
  }
}

export async function fjernFraHurtigbuffer(storagePath: string) {
  try {
    if (typeof caches === "undefined") return
    const cache = await caches.open(CACHE_NAVN)
    await cache.delete(cacheNokkel(storagePath))
  } catch {
    // Ikke kritisk.
  }
}

/** Henter fila, fra nettleserens hurtigbuffer når den finnes der. */
export async function hentFil(storagePath: string, hentUrl: () => Promise<string>): Promise<ArrayBuffer> {
  const nokkel = cacheNokkel(storagePath)
  let cache: Cache | null = null
  try {
    cache = typeof caches !== "undefined" ? await caches.open(CACHE_NAVN) : null
    const treff = await cache?.match(nokkel)
    if (treff) return await treff.arrayBuffer()
  } catch {
    cache = null
  }
  const url = await hentUrl()
  const respons = await fetch(url)
  if (!respons.ok) throw new Error("Fant ikke fila. Den kan være slettet.")
  const data = await respons.arrayBuffer()
  try {
    await cache?.put(nokkel, new Response(data.slice(0)))
  } catch {
    // Full disk eller privat modus: helt greit, vi henter på nytt neste gang.
  }
  return data
}

export type LastetModell = {
  geometri: ImportGeometri
  /** IFC: henter egenskaper og mengder for et element. */
  hentInfo?: (expressId: number) => Promise<IfcEgenskapsgruppe[]>
  /** Frigjør arbeideren. */
  lukk: () => void
}

export async function lastModell(
  format: ImportFormat,
  data: ArrayBuffer,
  onFremdrift?: (andel: number) => void
): Promise<LastetModell> {
  if (format === "ifc") return lastIfc(data, onFremdrift)
  const objekt = await lesMedThree(format, data)
  const geometri = await tilGeometri(objekt, format)
  return { geometri, lukk: () => {} }
}

// ---------------------------------------------------------------------------
// IFC
// ---------------------------------------------------------------------------

function lastIfc(data: ArrayBuffer, onFremdrift?: (andel: number) => void): Promise<LastetModell> {
  const arbeider = new Worker(new URL("./ifc.worker.ts", import.meta.url), { type: "module" })
  const ventende = new Map<number, (grupper: IfcEgenskapsgruppe[]) => void>()

  return new Promise<LastetModell>((resolve, reject) => {
    let ferdig = false
    arbeider.onmessage = (event: MessageEvent<IfcSvar>) => {
      const melding = event.data
      if (melding.type === "fremdrift") onFremdrift?.(melding.andel)
      else if (melding.type === "ferdig") {
        ferdig = true
        resolve({
          geometri: melding.geometri,
          hentInfo: (expressId) =>
            new Promise((ok) => {
              ventende.set(expressId, ok)
              arbeider.postMessage({ type: "info", expressId })
            }),
          lukk: () => arbeider.terminate(),
        })
      } else if (melding.type === "info") {
        ventende.get(melding.expressId)?.(melding.grupper)
        ventende.delete(melding.expressId)
      } else if (melding.type === "feil") {
        if (!ferdig) {
          arbeider.terminate()
          reject(new Error(melding.melding))
        }
      }
    }
    arbeider.onerror = () => {
      if (ferdig) return
      arbeider.terminate()
      reject(new Error("IFC-leseren kunne ikke startes. Last siden på nytt og prøv igjen."))
    }
    arbeider.postMessage({ type: "les", data }, [data])
  })
}

// ---------------------------------------------------------------------------
// Andre formater (three.js-lesere)
// ---------------------------------------------------------------------------

const tekst = (data: ArrayBuffer) => new TextDecoder().decode(data)

async function lesMedThree(format: ImportFormat, data: ArrayBuffer): Promise<THREE.Object3D> {
  const THREE = await import("three")
  switch (format) {
    case "glb":
    case "gltf": {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js")
      const { MeshoptDecoder } = await import("three/examples/jsm/libs/meshopt_decoder.module.js")
      const leser = new GLTFLoader()
      leser.setMeshoptDecoder(MeshoptDecoder)
      try {
        const gltf = await leser.parseAsync(format === "gltf" ? tekst(data) : data, "")
        return gltf.scene
      } catch (error) {
        const melding = error instanceof Error ? error.message : ""
        if (/draco/i.test(melding)) {
          throw new Error("Fila er Draco-komprimert. Eksporter uten komprimering og prøv igjen.")
        }
        if (/external|uri|\.bin/i.test(melding)) {
          throw new Error("glTF-fila peker på egne filer (.bin/teksturer). Eksporter som én GLB-fil.")
        }
        throw error
      }
    }
    case "obj": {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js")
      return new OBJLoader().parse(tekst(data))
    }
    case "fbx": {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js")
      return new FBXLoader().parse(data, "")
    }
    case "dae": {
      const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js")
      const resultat = new ColladaLoader().parse(tekst(data), "")
      if (!resultat?.scene) throw new Error("Fant ingen modell i DAE-fila.")
      return resultat.scene
    }
    case "kmz": {
      const { KMZLoader } = await import("three/examples/jsm/loaders/KMZLoader.js")
      return new KMZLoader().parse(data).scene
    }
    case "stl": {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js")
      return new THREE.Mesh(new STLLoader().parse(data), new THREE.MeshStandardMaterial({ color: "#c9cdd2" }))
    }
    case "3ds": {
      const { TDSLoader } = await import("three/examples/jsm/loaders/TDSLoader.js")
      return new TDSLoader().parse(data, "")
    }
    case "3mf": {
      const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js")
      return new ThreeMFLoader().parse(data)
    }
    case "ply": {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js")
      const geometri = new PLYLoader().parse(data)
      if (!geometri.index && geometri.getAttribute("position").count % 3 !== 0) {
        throw new Error("PLY-fila er en punktsky. Bare flater (trekanter) kan vises.")
      }
      return new THREE.Mesh(geometri, new THREE.MeshStandardMaterial({ color: "#c9cdd2" }))
    }
    case "wrl": {
      const { VRMLLoader } = await import("three/examples/jsm/loaders/VRMLLoader.js")
      return new VRMLLoader().parse(tekst(data), "")
    }
    default:
      throw new Error("Dette er en tegning, ikke en 3D-modell.")
  }
}

const FORMATNAVN: Partial<Record<ImportFormat, string>> = {
  glb: "Del",
  gltf: "Del",
  obj: "Del",
  fbx: "Del",
  dae: "Del",
  kmz: "Del",
  stl: "Modell",
  "3ds": "Del",
  "3mf": "Del",
  ply: "Modell",
  wrl: "Del",
}

/** Alle flater i en three-scene, i modellens koordinater, slått sammen per farge. */
export async function tilGeometri(objekt: THREE.Object3D, format: ImportFormat): Promise<ImportGeometri> {
  const THREE = await import("three")
  objekt.updateMatrixWorld(true)
  const deler: GeometriDel[] = []
  const elementer: ImportElement[] = []
  const punkt = new THREE.Vector3()
  const normal = new THREE.Vector3()
  const normalMatrise = new THREE.Matrix3()

  objekt.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    const geometri = mesh.geometry as THREE.BufferGeometry
    const posisjon = geometri.getAttribute("position")
    if (!posisjon || posisjon.count < 3) return
    const normaler = geometri.getAttribute("normal")
    normalMatrise.getNormalMatrix(mesh.matrixWorld)

    const elementNr = elementer.length
    elementer.push({
      id: elementNr,
      navn: mesh.name || mesh.parent?.name || "",
      type: FORMATNAVN[format] ?? "Del",
    })

    const pos = new Float32Array(posisjon.count * 3)
    let nor = normaler ? new Float32Array(posisjon.count * 3) : null
    for (let i = 0; i < posisjon.count; i++) {
      punkt.fromBufferAttribute(posisjon, i).applyMatrix4(mesh.matrixWorld)
      pos[i * 3] = punkt.x
      pos[i * 3 + 1] = punkt.y
      pos[i * 3 + 2] = punkt.z
      if (nor && normaler) {
        normal.fromBufferAttribute(normaler, i).applyMatrix3(normalMatrise)
        // Mange STL-eksporter skriver «facet normal 0 0 0». Med slike normaler
        // blir modellen svart; da regnes de ut på nytt i stedet.
        if (!(normal.lengthSq() > 1e-12)) {
          nor = null
          continue
        }
        normal.normalize()
        nor[i * 3] = normal.x
        nor[i * 3 + 1] = normal.y
        nor[i * 3 + 2] = normal.z
      }
    }
    const alleIndekser = geometri.index
      ? Array.from(geometri.index.array as ArrayLike<number>)
      : Array.from({ length: posisjon.count - (posisjon.count % 3) }, (_, i) => i)

    const materialer = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    const grupper = geometri.groups.length > 0 && Array.isArray(mesh.material)
      ? geometri.groups
      : [{ start: 0, count: alleIndekser.length, materialIndex: 0 }]

    for (const gruppe of grupper) {
      const materiale = materialer[gruppe.materialIndex ?? 0] as THREE.MeshStandardMaterial | undefined
      const farge = materiale?.color ? fargeFra(materiale.color) : ([0.79, 0.8, 0.82] as [number, number, number])
      const opasitet = materiale?.transparent ? Math.max(0.15, materiale.opacity ?? 1) : 1
      const indekser = alleIndekser.slice(gruppe.start, gruppe.start + gruppe.count)
      // Ett materiale: hele meshet som det er. Flere: bare punktene denne
      // gruppen bruker, ellers kopieres alle punktene én gang per materiale.
      const del = grupper.length === 1 ? { posisjoner: pos, normaler: nor, indekser } : komprimer(pos, nor, indekser)
      deler.push({ ...del, farge, opasitet, element: elementNr })
    }
  })

  return slaSammen(deler, elementer)
}

/** Plukker ut punktene en indeksliste bruker, og nummererer dem på nytt. */
export function komprimer(posisjoner: Float32Array, normaler: Float32Array | null, indekser: number[]) {
  const nytt = new Map<number, number>()
  const nyeIndekser = new Array<number>(indekser.length)
  for (let i = 0; i < indekser.length; i++) {
    let n = nytt.get(indekser[i])
    if (n === undefined) {
      n = nytt.size
      nytt.set(indekser[i], n)
    }
    nyeIndekser[i] = n
  }
  const pos = new Float32Array(nytt.size * 3)
  const nor = normaler ? new Float32Array(nytt.size * 3) : null
  for (const [gammel, ny] of nytt) {
    pos.set(posisjoner.subarray(gammel * 3, gammel * 3 + 3), ny * 3)
    if (nor && normaler) nor.set(normaler.subarray(gammel * 3, gammel * 3 + 3), ny * 3)
  }
  return { posisjoner: pos, normaler: nor, indekser: nyeIndekser }
}

/** three bruker lineære farger internt; vi lagrer sRGB (som IFC). */
function fargeFra(color: THREE.Color): [number, number, number] {
  const kopi = color.clone().convertLinearToSRGB()
  return [kopi.r, kopi.g, kopi.b]
}
