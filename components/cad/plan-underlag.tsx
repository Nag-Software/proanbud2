"use client"

/**
 * Importerte filer i plantegningen:
 *  - Tegninger (DXF, PDF, bilde) under veggene, i riktig målestokk, så man kan
 *    tegne vegger rett oppå en arkitekttegning.
 *  - 3D-filer som et stiplet fotavtrykk med navn, så man ser hvor de ligger.
 *
 * Alt tegnes i planets meter med én SVG-transform per fil; selve linjene og
 * bildet bygges bare én gang per fil, så panorering og zoom er billig.
 */

import * as React from "react"

import { modellFotavtrykk, tegningGrenserIPlan, tegningSvgTransform } from "@/lib/cad/import/plassering"
import { useCadImportAdapter, useLastedeImporter } from "@/lib/cad/import/use-import"
import type { LastetTegning } from "@/lib/cad/import/last-tegning"
import type { BuildingModel, ModelImport, Point } from "@/lib/cad/types"

export type ImportModus =
  | { type: "kalibrer"; importId: string; punkter: Point[]; onPunkt: (punkt: Point) => void }
  | { type: "flytt"; importId: string }

type Viewport = { scale: number; panX: number; panY: number }

/** Grenser i planet for alle synlige tegninger på etasjen (til «tilpass visning»). */
export type UnderlagGrenser = { minX: number; minY: number; maxX: number; maxY: number } | null

export function PlanUnderlag({
  model,
  storeyId,
  viewport,
  modus,
}: {
  model: BuildingModel
  storeyId: string | null
  viewport: Viewport
  modus: ImportModus | null
}) {
  const adapter = useCadImportAdapter()
  const forsteEtasje = model.storeys[0]?.id ?? null
  const synlige = React.useMemo(
    () =>
      (model.imports ?? []).filter(
        (entry) =>
          entry.visible &&
          (entry.kind === "model" || (entry.storeyId ?? forsteEtasje) === storeyId)
      ),
    [forsteEtasje, model.imports, storeyId]
  )
  const lastet = useLastedeImporter(synlige, adapter)
  const verden = `translate(${viewport.panX} ${viewport.panY}) scale(${viewport.scale} ${-viewport.scale})`

  return (
    <g pointerEvents="none">
      {lastet.map(({ entry, status }) => {
        if (status?.status !== "klar") return null
        if (entry.kind === "drawing" && status.tegning) {
          return (
            <g key={entry.id} transform={verden} opacity={entry.opacity * (modus?.importId === entry.id ? 1 : 0.85)}>
              <Tegning entry={entry} tegning={status.tegning} />
            </g>
          )
        }
        const grenser = status.modell?.geometri.grenser
        if (entry.kind === "model" && grenser) {
          const fot = modellFotavtrykk(entry, grenser)
          const x = fot.minX * viewport.scale + viewport.panX
          const y = -fot.maxY * viewport.scale + viewport.panY
          const w = (fot.maxX - fot.minX) * viewport.scale
          const h = (fot.maxY - fot.minY) * viewport.scale
          return (
            <g key={entry.id}>
              <rect x={x} y={y} width={w} height={h} fill="none" stroke="#2563eb" strokeOpacity={0.55} strokeDasharray="6 5" />
              {w > 60 && (
                <text x={x + 6} y={y + 14} className="fill-blue-700/70 text-[11px]">
                  {entry.name}
                </text>
              )}
            </g>
          )
        }
        return null
      })}

      {modus?.type === "kalibrer" &&
        modus.punkter.map((punkt, i) => (
          <g key={i}>
            <circle
              cx={punkt.x * viewport.scale + viewport.panX}
              cy={-punkt.y * viewport.scale + viewport.panY}
              r={6}
              className="fill-amber-500 stroke-background"
              strokeWidth={2}
            />
          </g>
        ))}
      {modus?.type === "kalibrer" && modus.punkter.length === 2 && (
        <line
          x1={modus.punkter[0].x * viewport.scale + viewport.panX}
          y1={-modus.punkter[0].y * viewport.scale + viewport.panY}
          x2={modus.punkter[1].x * viewport.scale + viewport.panX}
          y2={-modus.punkter[1].y * viewport.scale + viewport.panY}
          className="stroke-amber-500"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
      )}
    </g>
  )
}

const Tegning = React.memo(function Tegning({ entry, tegning }: { entry: ModelImport; tegning: LastetTegning }) {
  if (tegning.type === "bilde") {
    return (
      <g transform={tegningSvgTransform(entry, true)}>
        <image href={tegning.url} x={0} y={0} width={tegning.bredde} height={tegning.hoyde} preserveAspectRatio="none" />
      </g>
    )
  }
  return <DxfLinjer entry={entry} tegning={tegning} />
})

function DxfLinjer({ entry, tegning }: { entry: ModelImport; tegning: Extract<LastetTegning, { type: "linjer" }> }) {
  // Koordinatene gjøres relative til tegningens hjørne: georefererte DXF-er
  // ligger millioner av enheter fra origo, og da blir SVG-en unøyaktig.
  const origo = tegning.grenser ? { x: tegning.grenser.minX, y: tegning.grenser.minY } : { x: 0, y: 0 }
  const sti = React.useMemo(() => {
    const s = tegning.segmenter
    const deler: string[] = []
    for (let i = 0; i + 3 < s.length; i += 4) {
      deler.push(
        `M${(s[i] - origo.x).toFixed(2)} ${(s[i + 1] - origo.y).toFixed(2)}L${(s[i + 2] - origo.x).toFixed(2)} ${(s[i + 3] - origo.y).toFixed(2)}`
      )
    }
    return deler.join("")
  }, [origo.x, origo.y, tegning.segmenter])

  return (
    <g transform={`${tegningSvgTransform(entry, false)} translate(${origo.x} ${origo.y})`}>
      <path d={sti} fill="none" stroke="#475569" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </g>
  )
}

/**
 * Ytre grenser i planet for det som er importert og synlig på etasjen
 * (tegninger og fotavtrykket til 3D-filer), til «tilpass visning».
 */
export function useImportGrenser(model: BuildingModel, storeyId: string | null): UnderlagGrenser {
  const adapter = useCadImportAdapter()
  const forsteEtasje = model.storeys[0]?.id ?? null
  const synlige = React.useMemo(
    () =>
      (model.imports ?? []).filter(
        (entry) => entry.visible && (entry.kind === "model" || (entry.storeyId ?? forsteEtasje) === storeyId)
      ),
    [forsteEtasje, model.imports, storeyId]
  )
  const lastet = useLastedeImporter(synlige, adapter)
  return React.useMemo(() => {
    let g: UnderlagGrenser = null
    for (const { entry, status } of lastet) {
      if (status?.status !== "klar") continue
      let b: UnderlagGrenser = null
      if (status.tegning) {
        const t = status.tegning
        const lokal = t.type === "linjer" ? t.grenser : { minX: 0, minY: 0, maxX: t.bredde, maxY: t.hoyde }
        if (lokal) b = tegningGrenserIPlan(entry, lokal, t.type === "bilde")
      } else if (status.modell?.geometri.grenser) {
        b = modellFotavtrykk(entry, status.modell.geometri.grenser)
      }
      if (!b) continue
      g = g
        ? { minX: Math.min(g.minX, b.minX), minY: Math.min(g.minY, b.minY), maxX: Math.max(g.maxX, b.maxX), maxY: Math.max(g.maxY, b.maxY) }
        : b
    }
    return g
  }, [lastet])
}
