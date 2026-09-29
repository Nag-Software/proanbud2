"use client"

/**
 * CAD-editoren: verktøylinje, plantegning, 3D-visning og egenskapspanel.
 *
 * Laget for folk som ikke tegner hver dag. Prinsippene:
 *  - Én rolig verktøylinje: de fire verktøyene man faktisk bruker (Velg,
 *    Vegg, Dør, Vindu) med tekst, resten under «Mer», og alt som gjelder
 *    etasjer, visning og nedlasting samlet i én «⋯»-meny.
 *  - Tegneflaten får plassen. Egenskapspanelet kommer bare fram når noe er
 *    valgt (eller når man ber om det), og kan lukkes.
 *  - Ingen «Lagre»-knapp å glemme: endringer lagres automatisk et øyeblikk
 *    etter at man stopper opp, med tydelig status.
 *  - Fullskjerm med ett klikk — på PC, nettbrett, telefon og i appen.
 *
 * Plan og 3D skriver til samme lager, så en vegg du drar i 3D flytter seg i
 * planen i samme bilde.
 */

import * as React from "react"
import { createPortal } from "react-dom"
import dynamic from "next/dynamic"
import {
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  DoorOpen,
  Download,
  Layers,
  Loader2,
  Map,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  MousePointer2,
  PanelsTopLeft,
  Redo2,
  Ruler,
  Sparkles,
  Square,
  Triangle,
  Undo2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { InspectorPanel } from "@/components/cad/inspector-panel"
import { MaterialsPanel } from "@/components/cad/materials-panel"
import { PlanCanvas } from "@/components/cad/plan-canvas"
import { TakeoffPanel } from "@/components/cad/takeoff-panel"
import { GenerateModelDialog } from "@/components/cad/generate-model-dialog"
import { buildOutlineFromWalls } from "@/lib/cad/outline"
import { exportModelToDxf } from "@/lib/cad/export/dxf"
import { exportModelToIfc } from "@/lib/cad/export/ifc"
import { exportModelToObj } from "@/lib/cad/export/obj"
import { CadStore, useCadState, type CadTool, type CadViewMode } from "@/lib/cad/store"
import { parseBuildingModel } from "@/lib/cad/schema"
import type { BuildingModel } from "@/lib/cad/types"
import { cn } from "@/lib/utils"

// 3D-scenen drar inn three.js (~600 kB). Den lastes først når fanen faktisk
// vises, slik at prosjektsiden ikke blir tyngre for de som ikke åpner modellen.
const Scene3D = dynamic(() => import("@/components/cad/scene-3d").then((module) => module.Scene3D), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-muted/30">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  ),
})

export type CadEditorProps = {
  modelId: string
  projectId: string
  projectName: string
  initialModel: BuildingModel
  initialRevision: number
  canEdit: boolean
  referenceImageCount: number
  onSave: (input: {
    modelId: string
    data: BuildingModel
    revision: number
  }) => Promise<
    { ok: true; data: { revision: number } } | { ok: false; error: string; code?: string }
  >
}

type ToolDef = {
  id: CadTool
  label: string
  short: string
  shortcut: string
  icon: React.ComponentType<{ className?: string }>
}

/** Det man bruker hele tiden — alltid synlig, med tekst. */
const PRIMARY_TOOLS: ToolDef[] = [
  { id: "select", label: "Velg og flytt", short: "Velg", shortcut: "V", icon: MousePointer2 },
  { id: "wall", label: "Tegn vegg", short: "Vegg", shortcut: "W", icon: PanelsTopLeft },
  { id: "door", label: "Sett inn dør", short: "Dør", shortcut: "D", icon: DoorOpen },
  { id: "window", label: "Sett inn vindu", short: "Vindu", shortcut: "F", icon: Square },
]

/** Det man trenger av og til — under «Mer». */
const MORE_TOOLS: ToolDef[] = [
  { id: "roof", label: "Tegn tak", short: "Tak", shortcut: "T", icon: Triangle },
  { id: "slab", label: "Tegn gulv / dekke", short: "Gulv", shortcut: "G", icon: Map },
  { id: "column", label: "Sett inn søyle", short: "Søyle", shortcut: "S", icon: Box },
  { id: "measure", label: "Mål avstand", short: "Mål", shortcut: "M", icon: Ruler },
]

const ALL_TOOLS = [...PRIMARY_TOOLS, ...MORE_TOOLS]

type PanelTab = "egenskaper" | "materialer" | "mengder"

/** Så lenge etter siste endring lagres modellen automatisk. */
const AUTOSAVE_DELAY_MS = 1_500
/** Ventetid før et nytt forsøk når lagringen feilet (nettbrudd e.l.). */
const AUTOSAVE_RETRY_MS = 10_000

export function CadEditor({
  modelId,
  projectId,
  projectName,
  initialModel,
  initialRevision,
  canEdit,
  referenceImageCount,
  onSave,
}: CadEditorProps) {
  const [store] = React.useState(() => new CadStore(initialModel))
  const state = useCadState(store)
  const [generateOpen, setGenerateOpen] = React.useState(false)
  const confirm = useConfirm()

  const activeStorey =
    state.model.storeys.find((storey) => storey.id === state.activeStoreyId) ??
    state.model.storeys[0]

  // --- Autolagring ------------------------------------------------------------
  const revisionRef = React.useRef(initialRevision)
  const savingRef = React.useRef(false)
  const [saving, setSaving] = React.useState(false)
  const [saveFailed, setSaveFailed] = React.useState(false)
  const [conflict, setConflict] = React.useState(false)

  const save = React.useCallback(async () => {
    if (!canEdit || savingRef.current || conflict) return
    const snapshot = store.getSnapshot()
    if (!snapshot.dirty) return
    savingRef.current = true
    setSaving(true)
    try {
      const result = await onSave({ modelId, data: snapshot.model, revision: revisionRef.current })
      if (!result.ok) {
        if (result.code === "conflict") setConflict(true)
        else setSaveFailed(true)
        return
      }
      revisionRef.current = result.data.revision
      setSaveFailed(false)
      // Ble det endret noe mens lagringen pågikk, er modellen fortsatt ulagret —
      // autolagringen tar den neste runden.
      if (store.getSnapshot().model === snapshot.model) store.markSaved()
    } catch {
      setSaveFailed(true)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [canEdit, conflict, modelId, onSave, store])

  // Lagre et øyeblikk etter at brukeren har stoppet opp. Hver endring starter
  // nedtellingen på nytt, og et pågående drag venter til det er sluppet.
  React.useEffect(() => {
    if (!canEdit || !state.dirty || saving || conflict) return
    const timer = window.setTimeout(
      () => {
        if (!store.isInteracting()) void save()
      },
      saveFailed ? AUTOSAVE_RETRY_MS : AUTOSAVE_DELAY_MS
    )
    return () => window.clearTimeout(timer)
  }, [canEdit, conflict, save, saveFailed, saving, state.dirty, state.model, store])

  // Går man fra fanen eller ut av modellen, lagres det som står igjen med én gang.
  const saveRef = React.useRef(save)
  React.useEffect(() => {
    saveRef.current = save
  }, [save])
  React.useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") void saveRef.current()
    }
    document.addEventListener("visibilitychange", flush)
    return () => {
      document.removeEventListener("visibilitychange", flush)
      void saveRef.current()
    }
  }, [])

  // Advar før fanen lukkes mens noe ikke er lagret ennå.
  React.useEffect(() => {
    if (!state.dirty && !saving) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [saving, state.dirty])

  // --- Fullskjerm -------------------------------------------------------------
  // Editoren legges over hele vinduet (fungerer overalt, også i appen og på
  // iPhone), og der nettleseren kan, skjules også nettleserens egen ramme. Vi
  // ber om fullskjerm for HELE dokumentet, ikke editor-elementet: menyer og
  // dialoger tegnes utenfor editoren og ville ellers blitt usynlige.
  const [fullscreen, setFullscreen] = React.useState(false)

  const enterFullscreen = React.useCallback(() => {
    setFullscreen(true)
    const root = document.documentElement
    if (!document.fullscreenElement && typeof root.requestFullscreen === "function") {
      root.requestFullscreen().catch(() => {
        // Ikke tillatt/støttet (f.eks. iPhone) — overlegget alene gjør jobben.
      })
    }
  }, [])

  const exitFullscreen = React.useCallback(() => {
    setFullscreen(false)
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  }, [])

  React.useEffect(() => {
    if (!fullscreen) return
    // Esc i nettleserens fullskjerm lukker den — da lukker vi overlegget også.
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) setFullscreen(false)
    }
    document.addEventListener("fullscreenchange", onFullscreenChange)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange)
      document.body.style.overflow = previousOverflow
    }
  }, [fullscreen])

  // --- Panelet ----------------------------------------------------------------
  // Åpnes av seg selv når noe velges, og lukkes igjen når valget oppheves —
  // med mindre brukeren åpnet det selv (mengder, etasjeinnstillinger).
  const [panel, setPanel] = React.useState<PanelTab | null>(null)
  const [panelFromSelection, setPanelFromSelection] = React.useState(false)
  const selectionKey = state.selection ? `${state.selection.kind}:${state.selection.id}` : null
  const [previousSelectionKey, setPreviousSelectionKey] = React.useState<string | null>(null)
  if (selectionKey !== previousSelectionKey) {
    setPreviousSelectionKey(selectionKey)
    if (selectionKey) {
      setPanel("egenskaper")
      setPanelFromSelection(true)
    } else if (panelFromSelection) {
      if (panel === "egenskaper") setPanel(null)
      setPanelFromSelection(false)
    }
  }

  const openPanel = (tab: PanelTab) => {
    setPanelFromSelection(false)
    setPanel(tab)
  }

  // --- Hurtigtaster -----------------------------------------------------------
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable
      if (typing) return

      const modifier = event.metaKey || event.ctrlKey

      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void save()
        return
      }
      if (modifier && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault()
        store.undo()
        return
      }
      if (
        modifier &&
        (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey))
      ) {
        event.preventDefault()
        store.redo()
        return
      }
      if (modifier) return

      // Esc lukker fullskjerm når det ikke er noe annet å avbryte: en åpen
      // meny/dialog, et verktøy i bruk eller et valgt element går først. (Menyen
      // lukker seg selv på samme tastetrykk, men står fortsatt i DOM-en her.)
      if (event.key === "Escape") {
        const layerOpen = document.querySelector(
          '[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]'
        )
        if (fullscreen && !layerOpen && state.tool === "select" && !state.selection) {
          exitFullscreen()
        }
        return
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        if (state.selection && canEdit) {
          event.preventDefault()
          store.deleteSelection()
        }
        return
      }

      const tool = ALL_TOOLS.find((item) => item.shortcut.toLowerCase() === event.key.toLowerCase())
      if (tool && canEdit) {
        event.preventDefault()
        store.setTool(tool.id)
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [canEdit, exitFullscreen, fullscreen, save, state.selection, state.tool, store])

  // --- Eksport ----------------------------------------------------------------
  const download = React.useCallback((content: BlobPart, filename: string, type: string) => {
    const blob = content instanceof Blob ? content : new Blob([content], { type })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [])

  const baseFilename = React.useMemo(
    () =>
      `${projectName || state.model.name}`
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || "modell",
    [projectName, state.model.name]
  )

  const handleExport = async (format: "ifc" | "glb" | "dxf" | "obj") => {
    try {
      if (format === "ifc") {
        download(
          exportModelToIfc(state.model, { projectName }),
          `${baseFilename}.ifc`,
          "application/x-step"
        )
        toast.success("IFC-fil lastet ned")
        return
      }
      if (format === "dxf") {
        download(exportModelToDxf(state.model), `${baseFilename}.dxf`, "application/dxf")
        toast.success("DXF-fil lastet ned")
        return
      }
      if (format === "obj") {
        download(exportModelToObj(state.model), `${baseFilename}.obj`, "text/plain")
        toast.success("OBJ-fil lastet ned")
        return
      }
      const { exportModelToGlb } = await import("@/lib/cad/export/gltf-client")
      download(await exportModelToGlb(state.model), `${baseFilename}.glb`, "model/gltf-binary")
      toast.success("GLB-fil lastet ned")
    } catch {
      toast.error("Nedlastingen feilet. Prøv igjen, eller velg et annet format.")
    }
  }

  // --- Ett-klikks-handlinger --------------------------------------------------
  const applyGeneratedModel = (model: BuildingModel) => {
    store.replaceModel(model)
    toast.success("Modellen er generert. Se over målene før du bruker den.")
  }

  const addFloorFromWalls = () => {
    const outline = buildOutlineFromWalls(activeStorey?.walls ?? [])
    if (!outline) {
      toast.error("Fant ingen lukket ytterkontur. Tegn vegger som møtes først.")
      return
    }
    store.addSlab(outline, "floor")
    toast.success("Gulv lagt inn etter ytterveggene")
  }

  const addRoofFromWalls = () => {
    const outline = buildOutlineFromWalls(activeStorey?.walls ?? [])
    if (!outline) {
      toast.error("Fant ingen lukket ytterkontur. Tegn vegger som møtes først.")
      return
    }
    store.addRoof(outline, "gable")
    toast.success("Saltak lagt inn over bygget")
  }

  const deleteStorey = async () => {
    const ok = await confirm({
      title: "Slette etasjen?",
      description: `${activeStorey?.name} og alt innholdet blir borte. Du kan angre etterpå.`,
      confirmText: "Slett etasje",
      variant: "destructive",
    })
    if (ok && activeStorey) store.deleteStorey(activeStorey.id)
  }

  const activeMoreTool = MORE_TOOLS.find((tool) => tool.id === state.tool) ?? null

  const editor = (
    <div
      className={cn(
        "flex flex-col overflow-hidden bg-card",
        fullscreen
          ? // Appen går under notch og hjemstripe (viewport-fit=cover) — hold
            // verktøylinjen og knappene nederst unna dem.
            "fixed inset-0 z-50 h-dvh w-screen pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
          : "h-[min(80vh,900px)] min-h-[560px] rounded-xl border"
      )}
    >
      {/* Verktøylinje. Én linje på PC; på smal skjerm brytes den pent i to
          i stedet for å rulle sidelengs forbi det man leter etter. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b px-2 py-2">
        {canEdit && (
          <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
            {PRIMARY_TOOLS.map((tool) => (
              <ToolButton
                key={tool.id}
                tool={tool}
                active={state.tool === tool.id}
                onClick={() => store.setTool(tool.id)}
              />
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant={activeMoreTool ? "default" : "ghost"}
                  size="sm"
                  className="h-8 gap-1 px-2"
                  aria-label="Flere verktøy"
                >
                  {activeMoreTool ? <activeMoreTool.icon className="size-4" /> : null}
                  <span className="text-xs">{activeMoreTool ? activeMoreTool.short : "Mer"}</span>
                  <ChevronDown className="size-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuLabel>Ett klikk</DropdownMenuLabel>
                <DropdownMenuItem onSelect={addRoofFromWalls}>
                  <Triangle className="size-4" />
                  Saltak over hele bygget
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={addFloorFromWalls}>
                  <Map className="size-4" />
                  Gulv etter ytterveggene
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Tegn selv</DropdownMenuLabel>
                {MORE_TOOLS.map((tool) => (
                  <DropdownMenuItem key={tool.id} onSelect={() => store.setTool(tool.id)}>
                    <tool.icon className="size-4" />
                    {tool.label}
                    <span className="ml-auto text-xs text-muted-foreground">{tool.shortcut}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {canEdit && (
          <div className="flex items-center gap-0.5">
            <IconButton label="Angre (⌘Z)" disabled={!state.canUndo} onClick={() => store.undo()}>
              <Undo2 className="size-4" />
            </IconButton>
            <IconButton label="Gjør om (⌘⇧Z)" disabled={!state.canRedo} onClick={() => store.redo()}>
              <Redo2 className="size-4" />
            </IconButton>
          </div>
        )}

        <ViewSwitch view={state.view} onChange={(view) => store.setView(view)} />

        {state.model.storeys.length > 1 && (
          <Select value={activeStorey?.id ?? ""} onValueChange={(value) => store.setActiveStorey(value)}>
            <SelectTrigger className="h-8 w-[140px]" aria-label="Etasje">
              <Layers className="size-3.5 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {state.model.storeys.map((storey) => (
                <SelectItem key={storey.id} value={storey.id}>
                  {storey.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {canEdit && (
            <SaveStatus saving={saving} dirty={state.dirty} failed={saveFailed} conflict={conflict} />
          )}

          <Button
            variant={fullscreen ? "default" : "outline"}
            size="sm"
            className="h-8 gap-1.5"
            onClick={fullscreen ? exitFullscreen : enterFullscreen}
            aria-label={fullscreen ? "Lukk fullskjerm" : "Fullskjerm"}
          >
            {fullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            <span className="hidden sm:inline">{fullscreen ? "Lukk fullskjerm" : "Fullskjerm"}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Flere valg">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => openPanel("mengder")}>
                Mengder (til tilbud)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openPanel("materialer")}>Materialer</DropdownMenuItem>

              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>Etasjer</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56">
                      <DropdownMenuItem
                        onSelect={() => {
                          store.setSelection(null)
                          openPanel("egenskaper")
                        }}
                      >
                        Innstillinger for {activeStorey?.name ?? "etasjen"}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => store.addStorey(true)}>
                        Ny etasje (kopi av denne)
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => store.addStorey(false)}>
                        Ny, tom etasje
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => store.rotateStorey(-90)}>
                        Roter 90° mot venstre
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => store.rotateStorey(90)}>
                        Roter 90° mot høyre
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        disabled={state.model.storeys.length <= 1}
                        onSelect={() => void deleteStorey()}
                      >
                        Slett etasjen
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Vis</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuCheckboxItem
                    checked={state.showDimensions}
                    onCheckedChange={() => store.toggle("showDimensions")}
                    onSelect={(event) => event.preventDefault()}
                  >
                    Mål på vegger
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={state.showRooms}
                    onCheckedChange={() => store.toggle("showRooms")}
                    onSelect={(event) => event.preventDefault()}
                  >
                    Rom og arealer
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={state.showGrid}
                    onCheckedChange={() => store.toggle("showGrid")}
                    onSelect={(event) => event.preventDefault()}
                  >
                    Rutenett
                  </DropdownMenuCheckboxItem>
                  {state.model.storeys.length > 1 && (
                    <DropdownMenuCheckboxItem
                      checked={state.showAllStoreys}
                      onCheckedChange={() => store.toggle("showAllStoreys")}
                      onSelect={(event) => event.preventDefault()}
                    >
                      Alle etasjer i 3D
                    </DropdownMenuCheckboxItem>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Download className="size-4" />
                  Last ned
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-72">
                  <DropdownMenuItem onSelect={() => void handleExport("ifc")}>
                    IFC (BIM — Solibri, Revit, ArchiCAD)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void handleExport("dxf")}>
                    DXF (plantegning til AutoCAD)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void handleExport("glb")}>
                    GLB (3D i nettleser og mobil)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void handleExport("obj")}>
                    OBJ (Blender, SketchUp)
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>

              {canEdit && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setGenerateOpen(true)}>
                    <Sparkles className="size-4" />
                    Lag modellen på nytt fra bilder
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {conflict && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          <span className="min-w-0 flex-1">
            Noen andre har endret modellen mens du jobbet. De siste endringene dine er ikke lagret.
          </span>
          <Button size="sm" variant="outline" className="h-8" onClick={() => window.location.reload()}>
            Last inn på nytt
          </Button>
        </div>
      )}

      {/* Arbeidsflate */}
      <div className="relative flex min-h-0 flex-1">
        {/* Delt visning gir to ubrukelige halvdeler på en telefon. Den løses i
            CSS, ikke ved å måle vinduet: `window.innerWidth` er 0 i det
            komponenten monteres i enkelte nettlesere og innebygde visninger,
            og en måling der ville låst alle til plantegningen. */}
        <div className="flex min-w-0 flex-1">
          {state.view !== "3d" && (
            <div
              className={cn(
                "min-w-0",
                state.view === "split" ? "w-full lg:w-1/2 lg:border-r" : "w-full"
              )}
            >
              <PlanCanvas
                store={store}
                onShowProperties={() => openPanel("egenskaper")}
                onAddFloorFromWalls={addFloorFromWalls}
                onAddRoofFromWalls={addRoofFromWalls}
                emptyState={
                  <EmptyPlanState
                    store={store}
                    canEdit={canEdit}
                    onGenerate={() => setGenerateOpen(true)}
                  />
                }
              />
            </div>
          )}
          {state.view !== "2d" && (
            <div
              className={cn(
                "min-w-0",
                state.view === "split" ? "hidden w-1/2 lg:block" : "w-full"
              )}
            >
              <Scene3D store={store} />
            </div>
          )}
        </div>

        {/* Panelet: egen kolonne på PC, et ark nederst på mindre skjermer. */}
        {panel && (
          <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[55%] flex-col rounded-t-xl border-t bg-card shadow-lg lg:static lg:max-h-none lg:w-[320px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:shadow-none">
            <Tabs
              value={panel}
              onValueChange={(value) => openPanel(value as PanelTab)}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <div className="flex items-center gap-1 p-2">
                <TabsList className="grid flex-1 grid-cols-3">
                  <TabsTrigger value="egenskaper">Egenskaper</TabsTrigger>
                  <TabsTrigger value="mengder">Mengder</TabsTrigger>
                  <TabsTrigger value="materialer">Materialer</TabsTrigger>
                </TabsList>
                <IconButton label="Lukk panelet" onClick={() => setPanel(null)}>
                  <X className="size-4" />
                </IconButton>
              </div>
              <TabsContent value="egenskaper" className="m-0 min-h-0 flex-1 overflow-y-auto">
                <InspectorPanel store={store} />
              </TabsContent>
              <TabsContent value="mengder" className="m-0 min-h-0 flex-1 overflow-y-auto">
                <TakeoffPanel store={store} projectId={projectId} />
              </TabsContent>
              <TabsContent value="materialer" className="m-0 min-h-0 flex-1 overflow-y-auto">
                <MaterialsPanel store={store} />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      <GenerateModelDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        projectId={projectId}
        modelId={modelId}
        referenceImageCount={referenceImageCount}
        onGenerated={(raw) => applyGeneratedModel(parseBuildingModel(raw, projectName))}
      />
    </div>
  )

  if (!fullscreen) return editor

  return (
    <>
      {/* Plassholder på siden, så resten av innholdet ikke hopper opp. */}
      <div className="flex h-[min(80vh,900px)] min-h-[560px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        Modellen er åpen i fullskjerm.
      </div>
      {/* Lagt rett i <body>: fixed-posisjonering inne i app-skallet kan
          fanges av sidebarens transformasjoner. */}
      {createPortal(editor, document.body)}
    </>
  )
}

function ToolButton({ tool, active, onClick }: { tool: ToolDef; active: boolean; onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "default" : "ghost"}
          size="sm"
          className="h-8 gap-1.5 px-2"
          onClick={onClick}
          aria-label={tool.label}
          aria-pressed={active}
        >
          <tool.icon className="size-4" />
          <span className="text-xs">{tool.short}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {tool.label} <span className="opacity-60">({tool.shortcut})</span>
      </TooltipContent>
    </Tooltip>
  )
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

/** 2D | 3D | Begge. «Begge» finnes bare der det er plass til to visninger. */
function ViewSwitch({ view, onChange }: { view: CadViewMode; onChange: (view: CadViewMode) => void }) {
  const options: Array<{ id: CadViewMode; label: string; className?: string }> = [
    // På smal skjerm viser «Begge» bare plantegningen — da er det 2D som er aktiv.
    { id: "2d", label: "2D" },
    { id: "3d", label: "3D" },
    { id: "split", label: "Begge", className: "hidden lg:inline-flex" },
  ]
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5" role="group" aria-label="Visning">
      {options.map((option) => {
        const active = view === option.id
        const activeOnSmall = option.id === "2d" && view === "split"
        return (
          <Button
            key={option.id}
            type="button"
            variant={active ? "secondary" : "ghost"}
            size="sm"
            className={cn(
              "h-7 px-2.5 text-xs",
              activeOnSmall && "max-lg:bg-secondary max-lg:text-secondary-foreground",
              option.className
            )}
            aria-pressed={active}
            onClick={() => onChange(option.id)}
          >
            {option.label}
          </Button>
        )
      })}
    </div>
  )
}

function SaveStatus({
  saving,
  dirty,
  failed,
  conflict,
}: {
  saving: boolean
  dirty: boolean
  failed: boolean
  conflict: boolean
}) {
  if (conflict) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-500">
        <AlertTriangle className="size-3.5" />
        Ikke lagret
      </span>
    )
  }
  if (failed && dirty && !saving) {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-500">
        <AlertTriangle className="size-3.5" />
        <span className="hidden sm:inline">Ikke lagret — prøver igjen</span>
        <span className="sm:hidden">Ikke lagret</span>
      </span>
    )
  }
  if (saving || dirty) {
    return (
      <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
        <Loader2 className="size-3.5 animate-spin" />
        Lagrer …
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground" aria-live="polite">
      <Check className="size-3.5 text-emerald-600" />
      Lagret
    </span>
  )
}

/**
 * Det brukeren møter på et prosjekt uten modell.
 *
 * Et blankt rutenett med åtte ikoner forteller ingen hva de skal gjøre. Her
 * står de tre reelle veiene inn: la ProAnbud lage utkastet, start fra en boks
 * med målene du har, eller tegn selv.
 */
function EmptyPlanState({
  store,
  canEdit,
  onGenerate,
}: {
  store: CadStore
  canEdit: boolean
  onGenerate: () => void
}) {
  const [width, setWidth] = React.useState("8")
  const [depth, setDepth] = React.useState("6")

  if (!canEdit) {
    return (
      <div className="rounded-xl border bg-background/95 p-5 text-center shadow-lg backdrop-blur">
        <p className="text-sm text-muted-foreground">
          Det er ikke tegnet noe på denne etasjen ennå.
        </p>
      </div>
    )
  }

  const parse = (value: string) => Number(value.replace(",", ".")) || 0

  return (
    <div className="space-y-4 rounded-xl border bg-background/95 p-5 shadow-lg backdrop-blur">
      <div>
        <p className="text-sm font-semibold text-foreground">Kom i gang med modellen</p>
        <p className="text-sm text-muted-foreground">
          Velg den raskeste veien inn. Alt kan endres etterpå.
        </p>
      </div>

      <Button className="w-full" onClick={onGenerate}>
        <Sparkles className="size-4" />
        Lag modell fra beskrivelse og bilder
      </Button>

      <div className="space-y-2 rounded-lg border p-3">
        <p className="text-xs font-medium text-foreground">Start fra et rektangel</p>
        <div className="flex items-end gap-2">
          <label className="flex-1 space-y-1">
            <span className="text-[11px] text-muted-foreground">Bredde (m)</span>
            <Input
              value={width}
              inputMode="decimal"
              onChange={(event) => setWidth(event.target.value)}
              className="h-8"
            />
          </label>
          <span className="pb-2 text-muted-foreground">×</span>
          <label className="flex-1 space-y-1">
            <span className="text-[11px] text-muted-foreground">Dybde (m)</span>
            <Input
              value={depth}
              inputMode="decimal"
              onChange={(event) => setDepth(event.target.value)}
              className="h-8"
            />
          </label>
          <Button
            variant="secondary"
            className="h-8"
            onClick={() => {
              const w = parse(width)
              const d = parse(depth)
              if (w < 0.5 || d < 0.5) {
                toast.error("Oppgi bredde og dybde i meter.")
                return
              }
              store.addRectangle(w, d, { withFloor: true })
              toast.success("Yttervegger og gulv lagt inn")
            }}
          >
            Lag
          </Button>
        </div>
      </div>

      <Button variant="outline" className="w-full" onClick={() => store.setTool("wall")}>
        <PanelsTopLeft className="size-4" />
        Tegn ytterveggene selv
      </Button>
    </div>
  )
}
