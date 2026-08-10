"use client"

/**
 * Mengdepanelet.
 *
 * Viser hva modellen faktisk består av — og gjør det til noe man kan handle på:
 * kopiere som tekst, eller sende rett inn i tilbudsgeneratoren som grunnlag.
 * Tallene kommer fra `computeTakeoff`, som regner på den parametriske modellen,
 * ikke på 3D-nettet.
 */

import * as React from "react"
import Link from "next/link"
import { ClipboardCopy, FileText, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import type { CadStore } from "@/lib/cad/store"
import { useCadState } from "@/lib/cad/store"
import { computeTakeoff, formatTakeoffForPrompt } from "@/lib/cad/takeoff"
import { cn } from "@/lib/utils"

export function TakeoffPanel({
  store,
  projectId,
  className,
}: {
  store: CadStore
  projectId?: string
  className?: string
}) {
  const state = useCadState(store)
  const takeoff = React.useMemo(() => computeTakeoff(state.model), [state.model])

  const totals = [
    { label: "Bruksareal (BRA)", value: formatNumber(takeoff.totals.grossFloorArea), unit: "m²" },
    { label: "Yttervegg, netto", value: formatNumber(takeoff.totals.exteriorWallArea), unit: "m²" },
    { label: "Innervegg, netto", value: formatNumber(takeoff.totals.interiorWallArea), unit: "m²" },
    { label: "Takflate", value: formatNumber(takeoff.totals.roofArea), unit: "m²" },
    { label: "Dekke", value: formatNumber(takeoff.totals.slabArea), unit: "m²" },
    { label: "Veggvolum", value: formatNumber(takeoff.totals.wallVolume, 2), unit: "m³" },
    { label: "Vegglengde", value: formatNumber(takeoff.totals.wallLength), unit: "m" },
    { label: "Dører", value: String(takeoff.totals.doorCount), unit: "stk" },
    { label: "Vinduer", value: String(takeoff.totals.windowCount), unit: "stk" },
  ]

  const sumNok = takeoff.materials.reduce((sum, group) => sum + (group.totalNok ?? 0), 0)

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="border-b px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Mengder fra modellen
        </p>
        <p className="text-sm text-muted-foreground">
          Netto mengder — åpninger er trukket fra, svinn er lagt til per materiale.
        </p>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section className="grid grid-cols-2 gap-2">
          {totals.map((item) => (
            <div key={item.label} className="rounded-lg border p-2.5">
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
              <p className="text-sm font-semibold tabular-nums">
                {item.value} <span className="text-xs font-normal text-muted-foreground">{item.unit}</span>
              </p>
            </div>
          ))}
        </section>

        {takeoff.rooms.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Rom
            </h3>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Rom</th>
                    <th className="px-2 py-1.5 text-right font-medium">Gulv</th>
                    <th className="px-2 py-1.5 text-right font-medium">Vegg</th>
                  </tr>
                </thead>
                <tbody>
                  {takeoff.rooms.map((room) => (
                    <tr key={room.id} className="border-t">
                      <td className="px-2 py-1.5">
                        <span className="block truncate font-medium">{room.name}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {room.storeyName}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatNumber(room.floorArea)} m²
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatNumber(room.wallArea)} m²
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Materialer
          </h3>

          {takeoff.materials.length === 0 ? (
            <div className="flex gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              <TriangleAlert className="size-4 shrink-0 text-amber-500" />
              <span>
                Ingen materialer er lagt på ennå. Velg en vegg, et tak eller et rom, og legg på et
                materiale fra Materialer-fanen — da får du mengder du kan prise.
              </span>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Vare</th>
                    <th className="px-2 py-1.5 text-right font-medium">Mengde</th>
                    <th className="px-2 py-1.5 text-right font-medium">Sum</th>
                  </tr>
                </thead>
                <tbody>
                  {takeoff.materials.map((group) => (
                    <tr key={group.materialId} className="border-t">
                      <td className="px-2 py-1.5">
                        <span className="block truncate font-medium">{group.materialName}</span>
                        {group.wastePercent > 0 && (
                          <span className="block text-[10px] text-muted-foreground">
                            inkl. {group.wastePercent} % svinn
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatNumber(group.quantityWithWaste, 2)} {group.unit}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {group.totalNok === null ? "—" : `${Math.round(group.totalNok)} kr`}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {sumNok > 0 && (
                  <tfoot>
                    <tr className="border-t bg-muted/30 font-semibold">
                      <td className="px-2 py-1.5">Materialsum</td>
                      <td />
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {Math.round(sumNok).toLocaleString("nb-NO")} kr
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {takeoff.unassignedCount > 0 && (
            <p className="text-[11px] text-muted-foreground">
              {takeoff.unassignedCount} flate
              {takeoff.unassignedCount === 1 ? "" : "r"} mangler materiale.
            </p>
          )}
        </section>

        <Separator />

        <section className="space-y-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(
                  formatTakeoffForPrompt(state.model, takeoff)
                )
                toast.success("Mengdegrunnlaget er kopiert")
              } catch {
                toast.error("Kunne ikke kopiere. Merk teksten manuelt.")
              }
            }}
          >
            <ClipboardCopy className="size-4" />
            Kopier mengdegrunnlag
          </Button>

          {projectId && (
            <Button asChild size="sm" className="w-full">
              <Link href={`/nytt-tilbud?projectId=${projectId}&kilde=modell`}>
                <FileText className="size-4" />
                Lag tilbud fra modellen
              </Link>
            </Button>
          )}

          <p className="text-[11px] text-muted-foreground">
            Tilbudsgeneratoren henter mengdene herfra automatisk når modellen er lagret.
          </p>
        </section>
      </div>
    </div>
  )
}

function formatNumber(value: number, decimals = 1) {
  return value.toFixed(decimals).replace(".", ",")
}
