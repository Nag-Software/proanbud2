// maplibre-gl 6 er ren ESM og laster arbeidertråden som en egen modulfil ved
// siden av hovedfila. Turbopack pakker hovedfila inn i en chunk, så den
// relative stien finnes ikke lenger og kartet blir stående tomt («Worker
// failed to load»). Vi legger derfor arbeideren og den delte modulen den
// importerer i public/maplibre/ og peker dit med setWorkerUrl
// (lib/geo/maplibre-worker.ts).
//
// Kopieres fra node_modules ved hver dev/build framfor å sjekkes inn: da kan
// arbeideren aldri komme i utakt med den installerte maplibre-versjonen.
import { copyFileSync, mkdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const from = path.join(root, "node_modules/maplibre-gl/dist")
const to = path.join(root, "public/maplibre")

mkdirSync(to, { recursive: true })
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(path.join(from, file), path.join(to, file))
}
