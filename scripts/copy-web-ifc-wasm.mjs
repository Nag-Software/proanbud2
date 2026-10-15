// web-ifc (IFC-import i 3D-modellen) laster en .wasm-fil ved kjøring. Den
// pakkes ikke av Turbopack, så den legges i public/web-ifc/ og arbeideren peker
// dit (lib/cad/import/ifc.worker.ts → SetWasmPath).
//
// Kopieres fra node_modules ved hver dev/build framfor å sjekkes inn: da kan
// wasm-fila aldri komme i utakt med den installerte web-ifc-versjonen.
import { copyFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const from = path.join(root, "node_modules/web-ifc")
const to = path.join(root, "public/web-ifc")

mkdirSync(to, { recursive: true })
copyFileSync(path.join(from, "web-ifc.wasm"), path.join(to, "web-ifc.wasm"))
