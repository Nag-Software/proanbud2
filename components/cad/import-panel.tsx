"use client"

/**
 * Importerte filer: legg til, se status, plasser og fjern.
 *
 * Fila leses i nettleseren FØR den lastes opp. Da får brukeren svar med en
 * gang hvis den ikke kan vises, og vi slipper å lagre filer ingen kan åpne.
 * Etter opplasting legges den i lageret (use-import.ts) og i nettleserens
 * hurtigbuffer, så den ikke hentes på nytt.
 *
 * 3D-filer legges med midten midt i det som er tegnet og bunnen på bakken.
 * Tegninger legges under plantegningen i antatt målestokk og kan kalibreres
 * mot et kjent mål.
 */

import * as React from "react"
import {
  AlertTriangle,
  Box,
  ChevronDown,
  Crosshair,
  Eye,
  EyeOff,
  FileImage,
  FileText,
  Loader2,
  LocateFixed,
  Move,
  Plus,
  RotateCcw,
  RotateCw,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { FieldGroup, NumberField } from "@/components/cad/inspector-panel"
import { formatInfo, formatMb, gjettSkala, SKALA_VALG, sjekkFil } from "@/lib/cad/import/formats"
import { MANGE_TREKANTER } from "@/lib/cad/import/geometri"
import { fjernFraHurtigbuffer, lastModell, leggIHurtigbuffer, type LastetModell } from "@/lib/cad/import/last-modell"
import { lastTegning, startSkala, type LastetTegning } from "@/lib/cad/import/last-tegning"
import {
  kalibrer,
  midtstillModell,
  midtstillTegning,
  modellFotavtrykk,
  modellGrenserIVerden,
  tegningGrenserIPlan,
} from "@/lib/cad/import/plassering"
import {
  forhandslast,
  glemImport,
  useCadImportAdapter,
  useLastetImport,
  type CadImportAdapter,
  type ImportStatus,
} from "@/lib/cad/import/use-import"
import { newId } from "@/lib/cad/presets"
import type { CadStore } from "@/lib/cad/store"
import { useCadState } from "@/lib/cad/store"
import type { BuildingModel, ModelImport, Point, Storey } from "@/lib/cad/types"
import { cn } from "@/lib/utils"

/** Kalibrering eller flytting som pågår. Editoren eier den; plantegningen tar imot klikkene. */
export type ImportValg =
  | { type: "kalibrer"; importId: string; punkter: Point[] }
  | { type: "flytt"; importId: string }
  | null

export type Opplasting = { id: string; navn: string; steg: "leser" | "laster opp"; andel: number | null }

/** Meter per PDF-punkt i målestokk 1:1. */
const PDF_PUNKT = 0.0254 / 72
const MALESTOKKER = [10, 20, 50, 100, 200, 250, 500, 1000]

/** PDF og bilder har y nedover fra øvre venstre hjørne; DXF har y opp. */
export function erYNed(entry: Pick<ModelImport, "format">) {
  return entry.format === "pdf" || entry.format === "png" || entry.format === "jpg"
}

function lokaleGrenser(tegning: LastetTegning) {
  return tegning.type === "linjer" ? tegning.grenser : { minX: 0, minY: 0, maxX: tegning.bredde, maxY: tegning.hoyde }
}

/** Midten av det som er tegnet (alle etasjer). Nye filer legges her. */
function midtenAvModellen(model: BuildingModel): Point {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const ta = (p: Point) => {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  for (const storey of model.storeys) {
    for (const wall of storey.walls) {
      ta(wall.a)
      ta(wall.b)
    }
    for (const slab of storey.slabs) slab.outline.forEach(ta)
  }
  return Number.isFinite(minX) ? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 } : { x: 0, y: 0 }
}

// ---------------------------------------------------------------------------
// Opplasting
// ---------------------------------------------------------------------------

export function useImportOpplasting(store: CadStore, adapter: CadImportAdapter | null) {
  const [opplastinger, setOpplastinger] = React.useState<Opplasting[]>([])
  const oppdater = React.useCallback((id: string, patch: Partial<Opplasting>) => {
    setOpplastinger((liste) => liste.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const importer = React.useCallback(
    async (filer: File[]) => {
      if (!adapter) {
        toast.error("Import er ikke tilgjengelig her.")
        return
      }
      for (const fil of filer) {
        const sjekk = sjekkFil(fil.name, fil.size)
        if (!sjekk.ok) {
          toast.error(sjekk.error, { description: fil.name })
          continue
        }
        const { info } = sjekk
        const id = newId("imp")
        setOpplastinger((liste) => [...liste, { id, navn: fil.name, steg: "leser", andel: null }])
        let modell: LastetModell | null = null
        let tegning: LastetTegning | null = null
        try {
          const data = await fil.arrayBuffer()
          // Leserne kan gi bufferen videre til en arbeidertråd; hurtigbufferen får en kopi.
          const kopi = data.slice(0)
          const snapshot = store.getSnapshot()
          const storey =
            snapshot.model.storeys.find((item) => item.id === snapshot.activeStoreyId) ?? snapshot.model.storeys[0]
          const mal = midtenAvModellen(snapshot.model)
          let entry: ModelImport = {
            id,
            name: fil.name,
            format: info.format,
            kind: info.kind,
            storagePath: "",
            sizeBytes: fil.size,
            visible: true,
            opacity: info.kind === "drawing" ? 0.7 : 1,
            scale: 1,
            offset: { x: 0, y: 0 },
            rotationDeg: 0,
            elevation: 0,
            upAxis: info.upAxis,
            storeyId: info.kind === "drawing" ? (storey?.id ?? null) : null,
            page: 1,
            createdAt: new Date().toISOString(),
          }

          if (info.kind === "model") {
            modell = await lastModell(info.format, data, (andel) => oppdater(id, { andel }))
            const g = modell.geometri.grenser
            if (!g) throw new Error("Fant ingen geometri i fila.")
            const storste = Math.max(g.max[0] - g.min[0], g.max[1] - g.min[1], g.max[2] - g.min[2])
            entry.scale = info.fixedScale ?? gjettSkala(storste)
            entry = { ...entry, ...midtstillModell(entry, g, mal, 0) }
          } else {
            tegning = await lastTegning(info.format, data, 1)
            entry.scale = startSkala(info.format, tegning)
            const lokal = lokaleGrenser(tegning)
            if (lokal) entry.offset = midtstillTegning(entry, lokal, erYNed(entry), mal)
          }

          oppdater(id, { steg: "laster opp", andel: null })
          const { storagePath } = await adapter.lastOpp(fil)
          entry = { ...entry, storagePath }
          await leggIHurtigbuffer(storagePath, kopi)
          forhandslast(entry, { status: "klar", modell, tegning })
          store.addImport(entry)

          if (modell && modell.geometri.trekanter > MANGE_TREKANTER) {
            toast.warning(`${fil.name} er en stor modell`, {
              description: "Den kan gå tregt på eldre telefoner. Skjul den når du ikke trenger den.",
            })
          } else {
            toast.success(`${fil.name} er lagt inn`, { description: importHint(entry) })
          }
        } catch (error) {
          modell?.lukk()
          if (tegning?.type === "bilde" && tegning.url.startsWith("blob:")) URL.revokeObjectURL(tegning.url)
          toast.error(error instanceof Error ? error.message : "Fila kunne ikke importeres.", {
            description: fil.name,
          })
        } finally {
          setOpplastinger((liste) => liste.filter((item) => item.id !== id))
        }
      }
    },
    [adapter, oppdater, store]
  )

  return { opplastinger, importer }
}

function importHint(entry: ModelImport) {
  if (entry.kind === "model") return "Se den i 3D. Trykk på en del for å se mål."
  if (entry.format === "pdf") return "Lagt inn som 1:100. Sjekk målestokken, eller kalibrer mot et kjent mål."
  if (entry.format === "png" || entry.format === "jpg") {
    return "Et bilde har ingen målestokk. Kalibrer det mot et kjent mål."
  }
  return "Tegningen ligger under plantegningen."
}

// ---------------------------------------------------------------------------
// Panelet
// ---------------------------------------------------------------------------

export function ImportPanel({
  store,
  canEdit,
  opplastinger,
  onVelgFil,
  valg,
  onValg,
}: {
  store: CadStore
  canEdit: boolean
  opplastinger: Opplasting[]
  onVelgFil: () => void
  valg: ImportValg
  onValg: (valg: ImportValg) => void
}) {
  const state = useCadState(store)
  const imports = React.useMemo(() => state.model.imports ?? [], [state.model.imports])
  const [apen, setApen] = React.useState<string | null>(null)

  // En fil som nettopp er lagt inn, åpnes, så brukeren ser målestokk og plassering.
  const [forrigeAntall, setForrigeAntall] = React.useState(imports.length)
  if (imports.length !== forrigeAntall) {
    setForrigeAntall(imports.length)
    if (imports.length > forrigeAntall) setApen(imports[imports.length - 1]?.id ?? null)
  }

  return (
    <div className="space-y-4 p-4">
      {canEdit && (
        <div className="space-y-2">
          <Button type="button" className="w-full gap-1.5" onClick={onVelgFil}>
            <Plus className="size-4" />
            Legg til fil
          </Button>
          <p className="text-xs text-muted-foreground">
            3D-modeller (IFC, GLB, OBJ, FBX, DAE, STL m.fl.) og tegninger (DXF, PDF, bilde). Opptil 100 MB.
          </p>
        </div>
      )}

      {opplastinger.map((item) => (
        <div key={item.id} className="flex items-center gap-2.5 rounded-[8px] border bg-muted/30 p-2.5">
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{item.navn}</div>
            <div className="text-xs text-muted-foreground tabular-nums">
              {item.steg === "leser"
                ? `Leser fila${item.andel !== null ? ` · ${Math.round(item.andel * 100)} %` : " …"}`
                : "Laster opp …"}
            </div>
          </div>
        </div>
      ))}

      {imports.length === 0 && opplastinger.length === 0 && (
        <p className="rounded-[8px] border border-dashed p-4 text-center text-sm text-muted-foreground">
          {canEdit
            ? "Ingen filer ennå. Legg inn arkitektens tegning eller modell og tegn rett oppå."
            : "Ingen filer er importert."}
        </p>
      )}

      <div className="space-y-2">
        {imports.map((entry) => (
          <ImportKort
            key={entry.id}
            store={store}
            entry={entry}
            canEdit={canEdit}
            storeys={state.model.storeys}
            apen={apen === entry.id}
            onApen={(open) => setApen(open ? entry.id : null)}
            valg={valg}
            onValg={onValg}
            onVisPlan={() => {
              if (state.view === "3d") store.setView("2d")
              if (entry.kind === "drawing") {
                store.setActiveStorey(entry.storeyId ?? state.model.storeys[0]?.id ?? "")
              }
            }}
          />
        ))}
      </div>

      {canEdit && <FormatHjelp />}
    </div>
  )
}

function ImportKort({
  store,
  entry,
  canEdit,
  storeys,
  apen,
  onApen,
  valg,
  onValg,
  onVisPlan,
}: {
  store: CadStore
  entry: ModelImport
  canEdit: boolean
  storeys: Storey[]
  apen: boolean
  onApen: (open: boolean) => void
  valg: ImportValg
  onValg: (valg: ImportValg) => void
  onVisPlan: () => void
}) {
  const adapter = useCadImportAdapter()
  const status = useLastetImport(entry, adapter)
  const confirm = useConfirm()
  const info = formatInfo(entry.format)
  const klar = status?.status === "klar" ? status : null
  const Ikon = entry.kind === "model" ? Box : entry.format === "dxf" ? FileText : FileImage
  const kalibrerer = valg?.type === "kalibrer" && valg.importId === entry.id ? valg : null
  const flytter = valg?.type === "flytt" && valg.importId === entry.id

  /** Endrer en 3D-fil og holder midten og bunnen der de var. */
  const endreModell = (patch: Partial<ModelImport>) => {
    const g = klar?.modell?.geometri.grenser
    if (!g) {
      store.updateImport(entry.id, patch)
      return
    }
    const fot = modellFotavtrykk(entry, g)
    const bunn = modellGrenserIVerden(entry, g).min[1]
    const midt = { x: (fot.minX + fot.maxX) / 2, y: (fot.minY + fot.maxY) / 2 }
    store.updateImport(entry.id, { ...patch, ...midtstillModell({ ...entry, ...patch }, g, midt, bunn) })
  }

  /** Endrer en tegning og holder midten der den var. */
  const endreTegning = (patch: Partial<ModelImport>) => {
    const lokal = klar?.tegning ? lokaleGrenser(klar.tegning) : null
    if (!lokal) {
      store.updateImport(entry.id, patch)
      return
    }
    const yNed = erYNed(entry)
    const g = tegningGrenserIPlan(entry, lokal, yNed)
    const midt = { x: (g.minX + g.maxX) / 2, y: (g.minY + g.maxY) / 2 }
    store.updateImport(entry.id, { ...patch, offset: midtstillTegning({ ...entry, ...patch }, lokal, yNed, midt) })
  }

  const endre = entry.kind === "model" ? endreModell : endreTegning

  const midtstill = () => {
    const mal = midtenAvModellen(store.getSnapshot().model)
    if (entry.kind === "model") {
      const g = klar?.modell?.geometri.grenser
      if (g) store.updateImport(entry.id, midtstillModell(entry, g, mal, 0))
    } else {
      const lokal = klar?.tegning ? lokaleGrenser(klar.tegning) : null
      if (lokal) store.updateImport(entry.id, { offset: midtstillTegning(entry, lokal, erYNed(entry), mal) })
    }
  }

  const slett = async () => {
    const ok = await confirm({
      title: "Fjerne fila?",
      description: `${entry.name} fjernes fra modellen og slettes.`,
      confirmText: "Fjern",
      variant: "destructive",
    })
    if (!ok) return
    if (valg?.importId === entry.id) onValg(null)
    store.removeImport(entry.id)
    glemImport(entry)
    void fjernFraHurtigbuffer(entry.storagePath)
    try {
      await adapter?.slett?.(entry.storagePath)
    } catch {
      // Fila blir liggende i lagringen. Ikke noe brukeren kan gjøre noe med.
    }
  }

  return (
    <div className={cn("rounded-[8px] border bg-background", (kalibrerer || flytter) && "border-amber-500/60")}>
      <div className="flex items-center gap-1 p-1.5 pl-2.5">
        <button
          type="button"
          className="flex min-h-10 min-w-0 flex-1 items-center gap-2.5 text-left"
          aria-expanded={apen}
          onClick={() => onApen(!apen)}
        >
          <Ikon className={cn("size-4 shrink-0", entry.visible ? "text-muted-foreground" : "text-muted-foreground/40")} />
          <span className="min-w-0 flex-1">
            <span className={cn("block truncate text-sm font-medium", !entry.visible && "text-muted-foreground")}>
              {entry.name}
            </span>
            <StatusLinje entry={entry} status={status} />
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", apen && "rotate-180")} />
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-10 shrink-0"
          aria-label={entry.visible ? `Skjul ${entry.name}` : `Vis ${entry.name}`}
          aria-pressed={entry.visible}
          onClick={() => store.updateImport(entry.id, { visible: !entry.visible })}
        >
          {entry.visible ? <Eye className="size-4" /> : <EyeOff className="size-4 text-muted-foreground" />}
        </Button>
      </div>

      {kalibrerer && klar?.tegning && (
        <Kalibrering
          entry={entry}
          punkter={kalibrerer.punkter}
          onBruk={(virkelig) => {
            const [a, b] = kalibrerer.punkter
            const ny = kalibrer(entry, a, b, virkelig, erYNed(entry))
            if (!ny) {
              toast.error("Punktene ligger oppå hverandre. Klikk to punkter et stykke fra hverandre.")
              return
            }
            store.updateImport(entry.id, ny)
            onValg(null)
            toast.success("Målestokken er justert")
          }}
          onPaNytt={() => onValg({ type: "kalibrer", importId: entry.id, punkter: [] })}
          onAvbryt={() => onValg(null)}
        />
      )}

      {apen && (
        <div className="space-y-4 border-t p-3">
          {status?.status === "feil" && (
            <p className="flex gap-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {status.melding}
            </p>
          )}

          {klar && canEdit && entry.kind === "drawing" && klar.tegning && (
            <FieldGroup title="Målestokk">
              <TegningMalestokk entry={entry} tegning={klar.tegning} onEndre={endreTegning} />
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={kalibrerer ? "default" : "outline"}
                  className="h-9 gap-1.5"
                  onClick={() => {
                    if (kalibrerer) {
                      onValg(null)
                      return
                    }
                    onVisPlan()
                    onValg({ type: "kalibrer", importId: entry.id, punkter: [] })
                  }}
                >
                  <Crosshair className="size-4" />
                  Kalibrer mot kjent mål
                </Button>
              </div>
            </FieldGroup>
          )}

          {klar && canEdit && entry.kind === "model" && (
            <FieldGroup title="Enhet og retning">
              <EnhetValg
                label="Enhet i fila"
                scale={entry.scale}
                onChange={(scale) => endreModell({ scale })}
              />
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Hva er opp i fila?</Label>
                <div className="grid grid-cols-2 gap-1 rounded-[8px] border bg-muted/40 p-0.5" role="group">
                  {(["y", "z"] as const).map((akse) => (
                    <Button
                      key={akse}
                      type="button"
                      size="sm"
                      variant={entry.upAxis === akse ? "secondary" : "ghost"}
                      className="h-8"
                      aria-pressed={entry.upAxis === akse}
                      onClick={() => endreModell({ upAxis: akse })}
                    >
                      {akse.toUpperCase()} opp
                    </Button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground">Ligger modellen på siden, bytt her.</p>
              </div>
            </FieldGroup>
          )}

          {klar && canEdit && (
            <FieldGroup title="Plassering">
              <div className="flex items-end gap-1.5">
                <div className="min-w-0 flex-1">
                  <NumberField
                    label="Rotasjon"
                    value={entry.rotationDeg}
                    onChange={(rotationDeg) => endre({ rotationDeg })}
                    unit="°"
                    step={1}
                    decimals={1}
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9"
                  aria-label="Roter 90° mot venstre"
                  onClick={() => endre({ rotationDeg: normalGrader(entry.rotationDeg + 90) })}
                >
                  <RotateCcw className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="size-9"
                  aria-label="Roter 90° mot høyre"
                  onClick={() => endre({ rotationDeg: normalGrader(entry.rotationDeg - 90) })}
                >
                  <RotateCw className="size-4" />
                </Button>
              </div>

              {entry.kind === "model" && klar.modell?.geometri.grenser && (
                <NumberField
                  label="Bunnen over bakken"
                  value={modellGrenserIVerden(entry, klar.modell.geometri.grenser).min[1]}
                  onChange={(bunn) => {
                    const g = klar.modell?.geometri.grenser
                    if (!g) return
                    const naa = modellGrenserIVerden(entry, g).min[1]
                    store.updateImport(entry.id, { elevation: entry.elevation + bunn - naa })
                  }}
                  unit="m"
                  step={0.1}
                  decimals={2}
                />
              )}

              {entry.kind === "drawing" && storeys.length > 1 && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Etasje</Label>
                  <Select
                    value={entry.storeyId ?? storeys[0]?.id}
                    onValueChange={(storeyId) => store.updateImport(entry.id, { storeyId })}
                  >
                    <SelectTrigger className="h-9 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {storeys.map((storey) => (
                        <SelectItem key={storey.id} value={storey.id}>
                          {storey.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={flytter ? "default" : "outline"}
                  className="h-9 gap-1.5"
                  aria-pressed={flytter}
                  onClick={() => {
                    if (flytter) {
                      onValg(null)
                      return
                    }
                    onVisPlan()
                    onValg({ type: "flytt", importId: entry.id })
                  }}
                >
                  <Move className="size-4" />
                  {flytter ? "Ferdig" : "Flytt i planet"}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-9 gap-1.5" onClick={midtstill}>
                  <LocateFixed className="size-4" />
                  Midtstill
                </Button>
              </div>
            </FieldGroup>
          )}

          {klar && (
            <div className="space-y-1">
              <Label htmlFor={`opasitet-${entry.id}`} className="text-xs text-muted-foreground">
                Synlighet {Math.round(entry.opacity * 100)} %
              </Label>
              <input
                id={`opasitet-${entry.id}`}
                type="range"
                min={10}
                max={100}
                step={5}
                value={Math.round(entry.opacity * 100)}
                onChange={(event) =>
                  store.updateImport(entry.id, { opacity: Number(event.target.value) / 100 }, { transient: true })
                }
                onPointerUp={() => store.commitTransient()}
                onKeyUp={() => store.commitTransient()}
                onBlur={() => store.commitTransient()}
                className="h-6 w-full accent-primary"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {info.label} · {formatMb(entry.sizeBytes)}
              {klar?.modell && klar.modell.geometri.elementer.length > 1
                ? ` · ${klar.modell.geometri.elementer.length.toLocaleString("nb-NO")} deler`
                : ""}
            </span>
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-destructive hover:text-destructive"
                onClick={() => void slett()}
              >
                <Trash2 className="size-4" />
                Fjern
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function normalGrader(grader: number) {
  const r = ((grader % 360) + 360) % 360
  return r > 180 ? r - 360 : r
}

function StatusLinje({ entry, status }: { entry: ModelImport; status: ImportStatus | null }) {
  if (!status || status.status === "laster") {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
        <Loader2 className="size-3 animate-spin" />
        {status?.andel != null ? `Leser … ${Math.round(status.andel * 100)} %` : "Leser …"}
      </span>
    )
  }
  if (status.status === "feil") {
    return <span className="block truncate text-xs text-destructive">Kan ikke vises</span>
  }
  const info = formatInfo(entry.format)
  let detalj = entry.kind === "model" ? "3D-modell" : "Tegning"
  if (entry.format === "pdf") {
    const n = Math.round(entry.scale / PDF_PUNKT)
    detalj = `1:${n.toLocaleString("nb-NO")}${status.tegning?.type === "bilde" && status.tegning.sider > 1 ? ` · side ${entry.page}` : ""}`
  }
  return (
    <span className="block truncate text-xs text-muted-foreground">
      {info.label} · {detalj}
    </span>
  )
}

function EnhetValg({ label, scale, onChange }: { label: string; scale: number; onChange: (scale: number) => void }) {
  const valgt = SKALA_VALG.find((item) => Math.abs(item.verdi - scale) / item.verdi < 1e-6)
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select value={valgt ? String(valgt.verdi) : "egen"} onValueChange={(value) => value !== "egen" && onChange(Number(value))}>
        <SelectTrigger className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SKALA_VALG.map((item) => (
            <SelectItem key={item.verdi} value={String(item.verdi)}>
              {item.navn}
            </SelectItem>
          ))}
          {!valgt && <SelectItem value="egen">Kalibrert</SelectItem>}
        </SelectContent>
      </Select>
    </div>
  )
}

function TegningMalestokk({
  entry,
  tegning,
  onEndre,
}: {
  entry: ModelImport
  tegning: LastetTegning
  onEndre: (patch: Partial<ModelImport>) => void
}) {
  if (entry.format === "dxf") {
    return <EnhetValg label="Enhet i tegningen" scale={entry.scale} onChange={(scale) => onEndre({ scale })} />
  }
  if (entry.format === "pdf") {
    const n = entry.scale / PDF_PUNKT
    const valgt = MALESTOKKER.find((item) => Math.abs(item - n) / item < 1e-3)
    const sider = tegning.type === "bilde" ? tegning.sider : 1
    return (
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Målestokk</Label>
          <Select
            value={valgt ? String(valgt) : "egen"}
            onValueChange={(value) => value !== "egen" && onEndre({ scale: PDF_PUNKT * Number(value) })}
          >
            <SelectTrigger className="h-9 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MALESTOKKER.map((item) => (
                <SelectItem key={item} value={String(item)}>
                  1:{item}
                </SelectItem>
              ))}
              {!valgt && <SelectItem value="egen">1:{Math.round(n)} (kalibrert)</SelectItem>}
            </SelectContent>
          </Select>
        </div>
        {sider > 1 && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Side</Label>
            <Select value={String(entry.page)} onValueChange={(value) => onEndre({ page: Number(value) })}>
              <SelectTrigger className="h-9 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: sider }, (_, i) => i + 1).map((side) => (
                  <SelectItem key={side} value={String(side)}>
                    Side {side} av {sider}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    )
  }
  return (
    <p className="text-xs text-muted-foreground">
      Et bilde har ingen målestokk. Kalibrer det mot et mål du kjenner, for eksempel en målsatt vegg.
    </p>
  )
}

function Kalibrering({
  entry,
  punkter,
  onBruk,
  onPaNytt,
  onAvbryt,
}: {
  entry: ModelImport
  punkter: Point[]
  onBruk: (virkeligMeter: number) => void
  onPaNytt: () => void
  onAvbryt: () => void
}) {
  const [verdi, setVerdi] = React.useState("")
  const malt = punkter.length === 2 ? Math.hypot(punkter[1].x - punkter[0].x, punkter[1].y - punkter[0].y) : null
  return (
    <div className="space-y-2 border-t bg-amber-500/10 p-3 text-xs">
      {malt === null ? (
        <p className="text-foreground">
          Klikk på to punkter i {entry.format === "pdf" ? "PDF-en" : "tegningen"} der du vet avstanden, for
          eksempel endene av en målsatt vegg.{" "}
          <span className="font-medium tabular-nums">{punkter.length} av 2</span>
        </p>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault()
            const mm = Number(verdi.replace(/\s/g, "").replace(",", "."))
            if (!(mm > 0)) {
              toast.error("Skriv inn avstanden i millimeter.")
              return
            }
            onBruk(mm / 1000)
          }}
        >
          <p className="text-foreground">
            Slik tegningen ligger nå, er avstanden{" "}
            <span className="font-medium tabular-nums">{Math.round(malt * 1000).toLocaleString("nb-NO")} mm</span>. Hva
            er den egentlig?
          </p>
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Input
                autoFocus
                inputMode="decimal"
                value={verdi}
                onChange={(event) => setVerdi(event.target.value)}
                placeholder="f.eks. 4800"
                className="h-9 pr-10 tabular-nums"
                aria-label="Virkelig avstand i millimeter"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                mm
              </span>
            </div>
            <Button type="submit" size="sm" className="h-9">
              Bruk
            </Button>
          </div>
        </form>
      )}
      <div className="flex gap-1">
        {punkter.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onPaNytt}>
            Start på nytt
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={onAvbryt}>
          Avbryt
        </Button>
      </div>
    </div>
  )
}

function FormatHjelp() {
  return (
    <details className="group rounded-[8px] border text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-medium">
        Hvilke filer kan jeg legge inn?
        <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2.5 border-t px-3 py-3 text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">3D-modeller</span> vises i 3D, og du kan måle på dem: IFC
          (Revit, ArchiCAD, Tekla), GLB/glTF, OBJ, FBX, DAE, KMZ, STL, 3DS, 3MF, PLY og VRML.
        </p>
        <p>
          <span className="font-medium text-foreground">Tegninger</span> legges under plantegningen i riktig
          målestokk: DXF, PDF, PNG og JPG.
        </p>
        <p>
          <span className="font-medium text-foreground">Andre formater</span> må lagres om først: DWG → DXF. Revit og
          ArchiCAD → IFC. SketchUp → GLB eller DAE.
        </p>
      </div>
    </details>
  )
}
