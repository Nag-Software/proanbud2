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
  FileUp,
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
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { ImportPanel, useImportOpplasting, type ImportValg } from "@/components/cad/import-panel"
import { InspectorPanel } from "@/components/cad/inspector-panel"
import { MaterialsPanel } from "@/components/cad/materials-panel"
import { PlanCanvas } from "@/components/cad/plan-canvas"
import type { ImportModus } from "@/components/cad/plan-underlag"
import { TakeoffPanel } from "@/components/cad/takeoff-panel"
import { GenerateModelDialog } from "@/components/cad/generate-model-dialog"
import { buildOutlineFromWalls } from "@/lib/cad/outline"
import { exportModelToDxf } from "@/lib/cad/export/dxf"
import { exportModelToIfc } from "@/lib/cad/export/ifc"
import { exportModelToObj } from "@/lib/cad/export/obj"
import { IMPORT_ACCEPT } from "@/lib/cad/import/formats"
import { CadImportContext, type CadImportAdapter } from "@/lib/cad/import/use-import"
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
  /** Opplasting og henting av importerte filer. Uten den kan filer ikke importeres. */
  importAdapter?: CadImportAdapter | null
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

type PanelTab = "egenskaper" | "materialer" | "mengder" | "import"

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
  importAdapter = null,
  onSave,
}: CadEditorProps) {
  const [store] = React.useState(() => new CadStore(initialModel))
  const state = useCadState(store)
  const [generateOpen, setGenerateOpen] = React.useState(false)
  const [rektangelOpen, setRektangelOpen] = React.useState(false)
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
    // Den som bare ser på (håndverkere), lagrer aldri — da er det ingenting å miste.
    if (!canEdit || (!state.dirty && !saving)) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [canEdit, saving, state.dirty])

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
    // Den som bare ser på, får målene i et kort i 3D i stedet for redigeringspanelet.
    if (selectionKey && canEdit) {
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

  // --- Import -----------------------------------------------------------------
  const { opplastinger, importer } = useImportOpplasting(store, importAdapter)
  const kanImportere = canEdit && importAdapter !== null
  const filRef = React.useRef<HTMLInputElement>(null)
  const velgFil = React.useCallback(() => filRef.current?.click(), [])
  // iOS gråer ut filer med endelser systemet ikke kjenner (.ifc, .dxf) når
  // `accept` er satt. Der sjekker vi heller fila etter at den er valgt.
  const [accept, setAccept] = React.useState<string | undefined>(IMPORT_ACCEPT)
  React.useEffect(() => {
    if (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent))) {
      setAccept(undefined)
    }
  }, [])
  const importerFiler = (filer: File[]) => {
    if (filer.length === 0) return
    openPanel("import")
    void importer(filer)
  }
  const [slippSone, setSlippSone] = React.useState(false)

  // Kalibrering og flytting av en importert fil. Begge trenger plantegningen og
  // panelet (der avstanden skrives inn), så de avbrytes hvis noe av det lukkes.
  const [importValg, setImportValg] = React.useState<ImportValg>(null)
  if (importValg && (panel !== "import" || state.view === "3d" || !state.model.imports?.some((item) => item.id === importValg.importId))) {
    setImportValg(null)
  }
  const importModus = React.useMemo((): ImportModus | null => {
    if (!importValg) return null
    if (importValg.type === "flytt") return importValg
    return {
      ...importValg,
      onPunkt: (punkt) =>
        setImportValg((naa) =>
          naa?.type === "kalibrer"
            ? { ...naa, punkter: naa.punkter.length >= 2 ? [punkt] : [...naa.punkter, punkt] }
            : naa
        ),
    }
  }, [importValg])

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
      if (event.key === "Escape" && importValg) {
        setImportValg(null)
        return
      }
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
  }, [canEdit, exitFullscreen, fullscreen, importValg, save, state.selection, state.tool, store])

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
                <DropdownMenuItem onSelect={() => setRektangelOpen(true)}>
                  <Square className="size-4" />
                  Rektangel (B × D)…
                </DropdownMenuItem>
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

        {kanImportere && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={panel === "import" ? "secondary" : "ghost"}
                size="sm"
                className="h-8 gap-1.5 px-2"
                onClick={() => (panel === "import" ? setPanel(null) : openPanel("import"))}
                aria-label="Importerte filer"
                aria-pressed={panel === "import"}
              >
                <FileUp className="size-4" />
                <span className="hidden text-xs sm:inline">Importer</span>
                {(state.model.imports?.length ?? 0) > 0 && (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">
                    {state.model.imports?.length}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>IFC, DXF, PDF og andre 3D-filer</TooltipContent>
          </Tooltip>
        )}

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
              {(state.model.imports?.length ?? 0) > 0 && (
                <DropdownMenuItem onSelect={() => openPanel("import")}>Importerte filer</DropdownMenuItem>
              )}

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
                    Lag modell fra beskrivelse og bilder
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

      {/* Arbeidsflate. Filer kan slippes rett på den. */}
      <div
        className="relative flex min-h-0 flex-1"
        onDragOver={(event) => {
          if (!kanImportere || !event.dataTransfer.types.includes("Files")) return
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
          if (!slippSone) setSlippSone(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSlippSone(false)
        }}
        onDrop={(event) => {
          if (!kanImportere) return
          event.preventDefault()
          setSlippSone(false)
          importerFiler(Array.from(event.dataTransfer.files))
        }}
      >
        {slippSone && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-[12px] border-2 border-dashed border-primary bg-primary/5 text-sm font-medium text-primary">
            Slipp fila for å legge den inn
          </div>
        )}
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
                canEdit={canEdit}
                onShowProperties={() => openPanel("egenskaper")}
                onAddFloorFromWalls={addFloorFromWalls}
                onAddRoofFromWalls={addRoofFromWalls}
                emptyState={<EmptyPlanState canEdit={canEdit} onImport={kanImportere ? velgFil : undefined} />}
                importModus={importModus}
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
              <Scene3D store={store} canEdit={canEdit} visElementKort={!canEdit || panel === null} />
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
                <TabsList className="grid flex-1 grid-cols-4">
                  <TabsTrigger value="egenskaper" className="px-1 text-xs">Egenskaper</TabsTrigger>
                  <TabsTrigger value="mengder" className="px-1 text-xs">Mengder</TabsTrigger>
                  <TabsTrigger value="materialer" className="px-1 text-xs">Materialer</TabsTrigger>
                  <TabsTrigger value="import" className="px-1 text-xs">Filer</TabsTrigger>
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
              <TabsContent value="import" className="m-0 min-h-0 flex-1 overflow-y-auto">
                <ImportPanel
                  store={store}
                  canEdit={kanImportere}
                  opplastinger={opplastinger}
                  onVelgFil={velgFil}
                  valg={importValg}
                  onValg={setImportValg}
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      {kanImportere && (
        <input
          ref={filRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(event) => {
            importerFiler(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
      )}

      <RektangelDialog
        open={rektangelOpen}
        onOpenChange={setRektangelOpen}
        onCreate={(width, depth) => {
          store.addRectangle(width, depth, { withFloor: true })
          toast.success("Yttervegger og gulv lagt inn")
        }}
      />

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

  if (!fullscreen) return <CadImportContext.Provider value={importAdapter}>{editor}</CadImportContext.Provider>

  return (
    <CadImportContext.Provider value={importAdapter}>
      {/* Plassholder på siden, så resten av innholdet ikke hopper opp. */}
      <div className="flex h-[min(80vh,900px)] min-h-[560px] items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        Modellen er åpen i fullskjerm.
      </div>
      {/* Lagt rett i <body>: fixed-posisjonering inne i app-skallet kan
          fanges av sidebarens transformasjoner. */}
      {createPortal(editor, document.body)}
    </CadImportContext.Provider>
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
 * Tom tegning: blank flate, så brukeren selv velger hvordan hen vil begynne.
 * Bare en diskré linje nederst som sier hvor man starter. Rektangel og
 * generering fra bilder ligger i menyene.
 */
function EmptyPlanState({ canEdit, onImport }: { canEdit: boolean; onImport?: () => void }) {
  return (
    <p className="max-w-full rounded-full border bg-background/90 px-3.5 py-1.5 text-center text-[12px] text-muted-foreground shadow-sm backdrop-blur">
      {canEdit ? (
        <>
          Tom tegning. Velg <span className="font-medium text-foreground">Vegg</span> for å tegne
          {onImport ? (
            <>
              , eller{" "}
              <button
                type="button"
                onClick={onImport}
                className="pointer-events-auto font-medium text-foreground underline underline-offset-2"
              >
                importer en fil
              </button>
            </>
          ) : null}
          .
        </>
      ) : (
        "Det er ikke tegnet noe på denne etasjen ennå."
      )}
    </p>
  )
}

/** «Rektangel»: fire yttervegger og gulv på B × D meter, i ett klikk. */
function RektangelDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (width: number, depth: number) => void
}) {
  const [width, setWidth] = React.useState("8")
  const [depth, setDepth] = React.useState("6")
  const parse = (value: string) => Number(value.replace(",", ".")) || 0
  const submit = () => {
    const w = parse(width)
    const d = parse(depth)
    if (w < 0.5 || d < 0.5) {
      toast.error("Oppgi bredde og dybde i meter.")
      return
    }
    onCreate(w, d)
    onOpenChange(false)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rektangel</DialogTitle>
          <DialogDescription>Fire yttervegger og gulv. Alt kan endres etterpå.</DialogDescription>
        </DialogHeader>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label className="flex-1 space-y-1">
            <span className="text-xs text-muted-foreground">Bredde (m)</span>
            <Input value={width} inputMode="decimal" autoFocus onChange={(event) => setWidth(event.target.value)} />
          </label>
          <span className="pb-2 text-muted-foreground">×</span>
          <label className="flex-1 space-y-1">
            <span className="text-xs text-muted-foreground">Dybde (m)</span>
            <Input value={depth} inputMode="decimal" onChange={(event) => setDepth(event.target.value)} />
          </label>
          <Button type="submit">Lag</Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
