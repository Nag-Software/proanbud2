"use client"

/**
 * CAD-editoren: verktøylinje, plantegning, 3D-visning og sidepaneler.
 *
 * Layoutvalget er hentet fra hvordan folk faktisk jobber i CAD: plan til
 * venstre (der man tegner presist), 3D til høyre (der man ser om det stemmer),
 * og egenskapene i en fast kolonne. Begge visningene skriver til samme lager,
 * så en vegg du drar i 3D flytter seg i planen i samme bilde.
 */

import * as React from "react"
import dynamic from "next/dynamic"
import {
  Box,
  Columns2,
  DoorOpen,
  Download,
  Grid3x3,
  Layers,
  Loader2,
  Map,
  MousePointer2,
  Move3d,
  PanelsTopLeft,
  Plus,
  Redo2,
  Ruler,
  Save,
  Sparkles,
  Square,
  Trash2,
  Triangle,
  Undo2,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
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
  }) => Promise<{ ok: true; data: { revision: number } } | { ok: false; error: string }>
}

const TOOLS: Array<{
  id: CadTool
  label: string
  short: string
  shortcut: string
  icon: React.ComponentType<{ className?: string }>
}> = [
  { id: "select", label: "Velg og flytt", short: "Velg", shortcut: "V", icon: MousePointer2 },
  { id: "wall", label: "Tegn vegg", short: "Vegg", shortcut: "W", icon: PanelsTopLeft },
  { id: "door", label: "Sett inn dør", short: "Dør", shortcut: "D", icon: DoorOpen },
  { id: "window", label: "Sett inn vindu", short: "Vindu", shortcut: "F", icon: Square },
  { id: "slab", label: "Tegn dekke (gulv)", short: "Dekke", shortcut: "G", icon: Map },
  { id: "roof", label: "Tegn tak", short: "Tak", shortcut: "T", icon: Triangle },
  { id: "column", label: "Sett inn søyle", short: "Søyle", shortcut: "S", icon: Box },
  { id: "measure", label: "Mål avstand", short: "Mål", shortcut: "M", icon: Ruler },
]

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
  const [revision, setRevision] = React.useState(initialRevision)
  const [saving, setSaving] = React.useState(false)
  const [generateOpen, setGenerateOpen] = React.useState(false)
  const [sidePanel, setSidePanel] = React.useState("egenskaper")
  const confirm = useConfirm()

  const activeStorey =
    state.model.storeys.find((storey) => storey.id === state.activeStoreyId) ??
    state.model.storeys[0]

  const save = React.useCallback(async () => {
    if (!canEdit || saving) return
    setSaving(true)
    try {
      const result = await onSave({ modelId, data: state.model, revision })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setRevision(result.data.revision)
      store.markSaved()
      toast.success("Modellen er lagret")
    } catch {
      toast.error("Kunne ikke lagre modellen. Prøv igjen om litt.")
    } finally {
      setSaving(false)
    }
  }, [canEdit, modelId, onSave, revision, saving, state.model, store])

  // --- Hurtigtaster ---------------------------------------------------------
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

      if (event.key === "Delete" || event.key === "Backspace") {
        if (state.selection) {
          event.preventDefault()
          store.deleteSelection()
        }
        return
      }

      const tool = TOOLS.find((item) => item.shortcut.toLowerCase() === event.key.toLowerCase())
      if (tool && canEdit) {
        event.preventDefault()
        store.setTool(tool.id)
      }
    }

    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [canEdit, save, state.selection, store])

  // Advar før brukeren navigerer bort med ulagrede endringer.
  React.useEffect(() => {
    if (!state.dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [state.dirty])

  const download = React.useCallback(
    (content: BlobPart, filename: string, type: string) => {
      const blob = content instanceof Blob ? content : new Blob([content], { type })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    },
    []
  )

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
      toast.error("Eksporten feilet. Prøv igjen, eller velg et annet format.")
    }
  }

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
    toast.success("Saltak lagt inn etter ytterveggene")
  }

  return (
    <div className="flex h-[min(78vh,900px)] min-h-[620px] flex-col overflow-hidden rounded-xl border bg-card">
      {/* Verktøylinje. På smal skjerm ruller den sidelengs i stedet for å bryte
          over fire linjer og spise hele tegneflaten. */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b px-2 py-2 lg:flex-wrap lg:overflow-x-visible">
        <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
          {TOOLS.map((tool) => (
            <Tooltip key={tool.id}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={state.tool === tool.id ? "default" : "ghost"}
                  size="sm"
                  className="h-8 gap-1.5 px-2"
                  disabled={!canEdit}
                  onClick={() => store.setTool(tool.id)}
                  aria-label={tool.label}
                  aria-pressed={state.tool === tool.id}
                >
                  <tool.icon className="size-4" />
                  {/* Ikoner alene er ikke selvforklarende for et verktøy folk
                      bruker sjelden. Teksten vises så snart det er plass. */}
                  <span className="hidden text-xs xl:inline">{tool.short}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {tool.label} <span className="opacity-60">({tool.shortcut})</span>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!state.canUndo}
            onClick={() => store.undo()}
            aria-label="Angre"
          >
            <Undo2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!state.canRedo}
            onClick={() => store.redo()}
            aria-label="Gjør om"
          >
            <Redo2 className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            disabled={!state.selection || !canEdit}
            onClick={() => store.deleteSelection()}
            aria-label="Slett valgt"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>

        <span className="mx-1 h-6 w-px bg-border" />

        {/* Etasjer */}
        <Select value={activeStorey?.id ?? ""} onValueChange={(value) => store.setActiveStorey(value)}>
          <SelectTrigger className="h-8 w-[150px]">
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 gap-1.5" disabled={!canEdit}>
              <Plus className="size-4" />
              Legg til
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Ett klikk</DropdownMenuLabel>
            <DropdownMenuItem onSelect={addFloorFromWalls}>
              Gulv etter ytterveggene
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={addRoofFromWalls}>
              Saltak etter ytterveggene
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Roter etasjen</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => store.rotateStorey(-90)}>
              90° mot venstre
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => store.rotateStorey(90)}>
              90° mot høyre
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Etasjer</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => store.addStorey(true)}>
              Ny etasje (kopi av denne)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => store.addStorey(false)}>Ny, tom etasje</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={state.model.storeys.length <= 1}
              onSelect={async () => {
                const ok = await confirm({
                  title: "Slette etasjen?",
                  description: `${activeStorey?.name} og alt innholdet blir borte. Du kan angre etterpå.`,
                  confirmText: "Slett etasje",
                  variant: "destructive",
                })
                if (ok && activeStorey) store.deleteStorey(activeStorey.id)
              }}
            >
              Slett etasjen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="mx-1 h-6 w-px bg-border" />

        {/* Visning */}
        <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5">
          {(
            [
              { id: "2d" as CadViewMode, label: "Plan", icon: Grid3x3 },
              { id: "split" as CadViewMode, label: "Delt", icon: Columns2 },
              { id: "3d" as CadViewMode, label: "3D", icon: Move3d },
            ]
          ).map((view) => (
            <Button
              key={view.id}
              variant={state.view === view.id ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => store.setView(view.id)}
            >
              <view.icon className="size-3.5" />
              {view.label}
            </Button>
          ))}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8">
              Visning
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={() => store.toggle("showGrid")}>
              {state.showGrid ? "✓ " : ""}Rutenett
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => store.toggle("showRooms")}>
              {state.showRooms ? "✓ " : ""}Rom og arealer
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => store.toggle("showDimensions")}>
              {state.showDimensions ? "✓ " : ""}Mål på vegger
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => store.toggle("showAllStoreys")}>
              {state.showAllStoreys ? "✓ " : ""}Alle etasjer i 3D
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className="ml-auto flex items-center gap-1.5">
          {state.dirty && (
            <span className="hidden text-xs text-amber-600 sm:inline dark:text-amber-500">
              Ulagrede endringer
            </span>
          )}

          {canEdit && (
            <Button variant="outline" size="sm" className="h-8" onClick={() => setGenerateOpen(true)}>
              <Sparkles className="size-4" />
              <span className="hidden sm:inline">Generer på nytt</span>
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-8">
                <Download className="size-4" />
                <span className="hidden sm:inline">Eksporter</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Byggebransjens formater</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void handleExport("ifc")}>
                IFC 4 (BIM — Solibri, Revit, ArchiCAD)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleExport("dxf")}>
                DXF (2D-plantegning til AutoCAD/DDS)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>3D-visning</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => void handleExport("glb")}>
                GLB (glTF — nettleser og mobil)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void handleExport("obj")}>
                OBJ (Blender, SketchUp)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {canEdit && (
            <Button size="sm" className="h-8" disabled={saving || !state.dirty} onClick={() => void save()}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Lagre
            </Button>
          )}
        </div>
      </div>

      {/* Arbeidsflate */}
      <div className="flex min-h-[320px] flex-1">
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
                onShowProperties={() => setSidePanel("egenskaper")}
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

        <div className="hidden w-[320px] shrink-0 border-l lg:block">
          <Tabs value={sidePanel} onValueChange={setSidePanel} className="flex h-full flex-col gap-0">
            <TabsList className="m-2 grid grid-cols-3">
              <TabsTrigger value="egenskaper">Egenskaper</TabsTrigger>
              <TabsTrigger value="materialer">Materialer</TabsTrigger>
              <TabsTrigger value="mengder">Mengder</TabsTrigger>
            </TabsList>
            <TabsContent value="egenskaper" className="m-0 min-h-0 flex-1">
              <InspectorPanel store={store} />
            </TabsContent>
            <TabsContent value="materialer" className="m-0 min-h-0 flex-1">
              <MaterialsPanel store={store} />
            </TabsContent>
            <TabsContent value="mengder" className="m-0 min-h-0 flex-1">
              <TakeoffPanel store={store} projectId={projectId} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Sidepanelene på mobil/nettbrett */}
      <div className="border-t lg:hidden">
        <Tabs value={sidePanel} onValueChange={setSidePanel}>
          <TabsList className="m-2 grid grid-cols-3">
            <TabsTrigger value="egenskaper">Egenskaper</TabsTrigger>
            <TabsTrigger value="materialer">Materialer</TabsTrigger>
            <TabsTrigger value="mengder">Mengder</TabsTrigger>
          </TabsList>
          <TabsContent value="egenskaper" className="m-0 max-h-[320px] overflow-y-auto">
            <InspectorPanel store={store} />
          </TabsContent>
          <TabsContent value="materialer" className="m-0 max-h-[320px] overflow-y-auto">
            <MaterialsPanel store={store} />
          </TabsContent>
          <TabsContent value="mengder" className="m-0 max-h-[320px] overflow-y-auto">
            <TakeoffPanel store={store} projectId={projectId} />
          </TabsContent>
        </Tabs>
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
