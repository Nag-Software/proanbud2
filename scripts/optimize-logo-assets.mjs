// One-off: shrink the oversized embedded PNG inside the logo/icon SVGs.
// The SVGs are mostly vector (wordmark paths) but embed a huge raster mark via
// a data: URI. The mark renders into a ~200px region and displays at ~24–40px,
// so a 400px source is plenty. We swap only the base64 payload — structure,
// viewBox, backdrop-filter and the vector paths are untouched.
import { readFileSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join } from "node:path"

const TARGETS = [
  { path: "public/logo/light/logo-primary.svg", maxDim: 400 },
  { path: "public/logo/light/icon-primary.svg", maxDim: 256 },
]

function optimize({ path, maxDim }) {
  const svg = readFileSync(path, "utf8")
  const m = svg.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)
  if (!m) {
    console.log(`SKIP ${path}: no embedded PNG`)
    return
  }
  const beforeBytes = Buffer.byteLength(svg, "utf8")
  const png = Buffer.from(m[1], "base64")
  const tmpIn = join(tmpdir(), "asset-in.png")
  const tmpOut = join(tmpdir(), "asset-out.png")
  writeFileSync(tmpIn, png)

  const dims = execSync(`sips -g pixelWidth -g pixelHeight "${tmpIn}"`).toString()
  const w = Number(dims.match(/pixelWidth:\s*(\d+)/)?.[1] || 0)
  const h = Number(dims.match(/pixelHeight:\s*(\d+)/)?.[1] || 0)

  // Resize the longest side to maxDim (sips -Z preserves aspect ratio).
  execSync(`sips -Z ${maxDim} "${tmpIn}" --out "${tmpOut}"`, { stdio: "ignore" })
  const small = readFileSync(tmpOut)
  const newB64 = small.toString("base64")
  const newSvg = svg.replace(m[1], newB64)
  writeFileSync(path, newSvg)

  const afterBytes = Buffer.byteLength(newSvg, "utf8")
  console.log(
    `${path}: raster ${w}x${h} -> max ${maxDim}px | file ${(beforeBytes / 1024).toFixed(0)}KB -> ${(afterBytes / 1024).toFixed(0)}KB`
  )
}

for (const t of TARGETS) optimize(t)
