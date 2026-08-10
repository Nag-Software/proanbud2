"use client"

/**
 * glTF/GLB-eksport.
 *
 * glTF er «JPEG-en for 3D»: det formatet man sender til noen som bare skal se
 * modellen — i nettleseren, på mobil, i en presentasjon. IFC er fasit for BIM,
 * glTF er fasit for visning.
 *
 * Scenen bygges opp på nytt fra modellen i stedet for å eksportere den scenen
 * som står på skjermen. Da får eksporten med seg alle etasjer uansett hva som
 * er skrudd på i visningen, og den virker selv om 3D-fanen aldri har vært åpen.
 */

import * as THREE from "three"
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js"

import { buildStoreySolids } from "../geometry"
import { ELEMENT_COLORS } from "../presets"
import type { BuildingModel, ElementSolid, Storey } from "../types"

function materialFor(model: BuildingModel, storey: Storey, solid: ElementSolid) {
  const assigned = solid.materialId
    ? model.materials.find((material) => material.id === solid.materialId)
    : undefined

  if (solid.elementKind === "opening") {
    const opening = storey.walls
      .flatMap((wall) => wall.openings)
      .find((candidate) => candidate.id === solid.elementId)
    const isWindow = opening?.kind !== "door"
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(assigned?.color ?? (isWindow ? ELEMENT_COLORS.glass : ELEMENT_COLORS.door)),
      transparent: isWindow,
      opacity: isWindow ? 0.35 : 1,
      roughness: isWindow ? 0.1 : 0.6,
    })
  }

  const fallback =
    solid.elementKind === "roof"
      ? ELEMENT_COLORS.roof
      : solid.elementKind === "slab"
        ? ELEMENT_COLORS.slab
        : solid.elementKind === "column"
          ? ELEMENT_COLORS.column
          : ELEMENT_COLORS.exterior

  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(assigned?.color ?? fallback),
    roughness: 0.9,
  })
}

export function buildExportScene(model: BuildingModel) {
  const scene = new THREE.Scene()
  scene.name = model.name

  for (const storey of model.storeys) {
    const group = new THREE.Group()
    group.name = storey.name

    for (const solid of buildStoreySolids(storey).solids) {
      if (solid.mesh.positions.length === 0) continue
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(solid.mesh.positions, 3)
      )
      geometry.setIndex(solid.mesh.indices)
      geometry.computeVertexNormals()

      const mesh = new THREE.Mesh(geometry, materialFor(model, storey, solid))
      mesh.name = `${solid.elementKind}_${solid.elementId}`
      group.add(mesh)
    }

    scene.add(group)
  }

  return scene
}

export async function exportModelToGlb(model: BuildingModel): Promise<Blob> {
  const scene = buildExportScene(model)
  const exporter = new GLTFExporter()

  const result = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (output) => {
        if (output instanceof ArrayBuffer) resolve(output)
        else reject(new Error("Forventet binær glTF"))
      },
      (error) => reject(error),
      { binary: true }
    )
  })

  // Rydd opp: geometriene er bare bygget for eksporten.
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose()
      if (Array.isArray(object.material)) object.material.forEach((item) => item.dispose())
      else object.material.dispose()
    }
  })

  return new Blob([result], { type: "model/gltf-binary" })
}
