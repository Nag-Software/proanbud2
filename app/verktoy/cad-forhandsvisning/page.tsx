"use client"

// MIDLERTIDIG verifiseringsside — slettes etter test.

import * as React from "react"

import { CadEditor } from "@/components/cad/cad-editor"
import type { CadImportAdapter } from "@/lib/cad/import/use-import"
import { createEmptyModel } from "@/lib/cad/schema"
import { syncSpaces } from "@/lib/cad/rooms"
import type { BuildingModel, Wall } from "@/lib/cad/types"

function wall(id: string, ax: number, ay: number, bx: number, by: number, extra: Partial<Wall> = {}): Wall {
  return {
    id,
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    thickness: 0.25,
    height: 2.4,
    baseOffset: 0,
    type: "exterior",
    openings: [],
    materialId: null,
    exteriorMaterialId: null,
    interiorMaterialId: null,
    label: null,
    ...extra,
  }
}

function demoModel(): BuildingModel {
  const model = createEmptyModel("Demohus")
  const walls: Wall[] = [
    wall("w1", 0, 0, 10, 0, {
      openings: [
        { id: "o1", kind: "door", distance: 2, width: 1, height: 2.1, sill: 0, label: "Ytterdør", materialId: null },
        { id: "o2", kind: "window", distance: 5, width: 1.8, height: 1.4, sill: 0.9, label: null, materialId: null },
        { id: "o3", kind: "window", distance: 8, width: 1.2, height: 1.2, sill: 0.9, label: null, materialId: null },
      ],
    }),
    wall("w2", 10, 0, 10, 7, {
      openings: [
        { id: "o4", kind: "window", distance: 3.5, width: 1.2, height: 1.2, sill: 0.9, label: null, materialId: null },
      ],
    }),
    wall("w3", 10, 7, 0, 7),
    wall("w4", 0, 7, 0, 0),
    wall("w5", 6, 0, 6, 7, { type: "interior", thickness: 0.1 }),
  ]

  model.storeys[0].walls = walls
  model.storeys[0].spaces = syncSpaces(walls, [])
  model.storeys[0].slabs = [
    {
      id: "sl1",
      kind: "foundation",
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 7 },
        { x: 0, y: 7 },
      ],
      thickness: 0.2,
      offset: 0,
      materialId: null,
      label: null,
    },
  ]
  model.storeys[0].roofs = [
    {
      id: "rf1",
      kind: "gable",
      outline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 7 },
        { x: 0, y: 7 },
      ],
      baseHeight: 2.4,
      pitchDeg: 32,
      directionDeg: 0,
      thickness: 0.3,
      overhang: 0.5,
      materialId: null,
      label: null,
    },
  ]
  return model
}

// Importerte filer holdes i minnet (ingen storage her). `?les` viser
// modellen slik en håndverker ser den.
const filer = new Map<string, string>()
const minneAdapter: CadImportAdapter = {
  lastOpp: async (file) => {
    const storagePath = `demo/demo/importer/${crypto.randomUUID()}-${file.name}`
    filer.set(storagePath, URL.createObjectURL(file))
    return { storagePath }
  },
  hentUrl: async (storagePath) => {
    const url = filer.get(storagePath)
    if (!url) throw new Error("Fant ikke fila. Den kan være slettet.")
    return url
  },
  slett: async (storagePath) => {
    const url = filer.get(storagePath)
    if (url) URL.revokeObjectURL(url)
    filer.delete(storagePath)
  },
}

export default function Page() {
  const [lesemodus, setLesemodus] = React.useState(false)
  React.useEffect(() => {
    setLesemodus(new URLSearchParams(window.location.search).has("les"))
  }, [])
  return (
    <div className="p-4">
      <CadEditor
        modelId="00000000-0000-0000-0000-000000000000"
        projectId="00000000-0000-0000-0000-000000000000"
        projectName="Demohus"
        initialModel={demoModel()}
        initialRevision={1}
        key={lesemodus ? "les" : "rediger"}
        canEdit={!lesemodus}
        referenceImageCount={0}
        importAdapter={minneAdapter}
        onSave={async () => ({ ok: true as const, data: { revision: 2 } })}
      />
    </div>
  )
}
