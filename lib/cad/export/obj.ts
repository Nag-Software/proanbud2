/**
 * Wavefront OBJ-eksport. Enkelt, tekstbasert 3D-format som åpnes av alt fra
 * Blender og SketchUp til Windows 3D-visning — nyttig når mottakeren bare skal
 * SE modellen og ikke trenger BIM-data (bruk IFC til det).
 *
 * Ett objekt per element, gruppert på etasje, slik at mottakeren kan skjule
 * deler i sin egen viser.
 */

import { buildModelSolids } from "../geometry"
import type { BuildingModel } from "../types"

const KIND_LABELS: Record<string, string> = {
  wall: "Vegg",
  opening: "Apning",
  slab: "Dekke",
  roof: "Tak",
  column: "Soyle",
  space: "Rom",
}

export function exportModelToObj(model: BuildingModel) {
  const lines: string[] = [
    `# ${model.name}`,
    "# Eksportert fra ProAnbud CAD",
    `# ${new Date().toISOString()}`,
    "",
  ]

  let vertexOffset = 1 // OBJ er 1-indeksert
  const storeySolids = buildModelSolids(model)

  model.storeys.forEach((storey, storeyIndex) => {
    const solids = storeySolids[storeyIndex]?.solids ?? []
    if (solids.length === 0) return

    lines.push(`g ${sanitize(storey.name)}`)

    for (const solid of solids) {
      if (solid.mesh.positions.length === 0) continue
      lines.push(`o ${sanitize(storey.name)}_${KIND_LABELS[solid.elementKind] ?? solid.elementKind}_${solid.elementId}`)

      for (let i = 0; i < solid.mesh.positions.length; i += 3) {
        lines.push(
          `v ${fixed(solid.mesh.positions[i])} ${fixed(solid.mesh.positions[i + 1])} ${fixed(
            solid.mesh.positions[i + 2]
          )}`
        )
      }

      for (let i = 0; i < solid.mesh.indices.length; i += 3) {
        lines.push(
          `f ${solid.mesh.indices[i] + vertexOffset} ${solid.mesh.indices[i + 1] + vertexOffset} ${
            solid.mesh.indices[i + 2] + vertexOffset
          }`
        )
      }

      vertexOffset += solid.mesh.positions.length / 3
    }
  })

  return lines.join("\n")
}

function fixed(value: number) {
  return (Math.round(value * 1e5) / 1e5).toFixed(5)
}

function sanitize(value: string) {
  return value.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "")
}
