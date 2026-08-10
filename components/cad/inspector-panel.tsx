"use client"

/**
 * Egenskapspanelet — den nøyaktige inngangen ved siden av musa.
 *
 * Alt du kan dra i, kan også skrives inn her med millimeterpresisjon. Det er
 * dette som gjør modellen «100 % fleksibel»: musa er for det raske, feltene er
 * for det eksakte (og for verdier som ikke har en naturlig håndtak-metafor,
 * som takvinkel eller brystningshøyde).
 */

import * as React from "react"
import { Lock, LockOpen, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { wallLength } from "@/lib/cad/geometry"
import { polygonArea, polygonPerimeter } from "@/lib/cad/math"
import {
  OPENING_LABELS,
  ROOF_LABELS,
  SLAB_LABELS,
  WALL_TYPE_LABELS,
  WALL_TYPE_THICKNESS,
} from "@/lib/cad/presets"
import type { CadStore, MaterialSlot } from "@/lib/cad/store"
import { useCadState } from "@/lib/cad/store"
import type {
  CadMaterial,
  OpeningKind,
  RoofKind,
  SlabKind,
  Storey,
  WallType,
} from "@/lib/cad/types"
import { cn } from "@/lib/utils"

export function InspectorPanel({ store, className }: { store: CadStore; className?: string }) {
  const state = useCadState(store)
  const storey =
    state.model.storeys.find((item) => item.id === state.activeStoreyId) ??
    state.model.storeys[0] ??
    null

  if (!storey) return null

  const selection = state.selection

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="border-b px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Egenskaper
        </p>
        <p className="text-sm font-semibold">{selectionTitle(state, storey)}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!selection && <StoreyFields store={store} storey={storey} />}

        {selection?.kind === "wall" && (
          <WallFields store={store} storey={storey} wallId={selection.id} />
        )}
        {selection?.kind === "opening" && (
          <OpeningFields
            store={store}
            storey={storey}
            wallId={selection.wallId}
            openingId={selection.id}
          />
        )}
        {selection?.kind === "slab" && (
          <SlabFields store={store} storey={storey} slabId={selection.id} />
        )}
        {selection?.kind === "roof" && (
          <RoofFields store={store} storey={storey} roofId={selection.id} />
        )}
        {selection?.kind === "column" && (
          <ColumnFields store={store} storey={storey} columnId={selection.id} />
        )}
        {selection?.kind === "space" && (
          <SpaceFields store={store} storey={storey} spaceId={selection.id} />
        )}
      </div>
    </div>
  )
}

function selectionTitle(state: ReturnType<typeof useCadState>, storey: Storey) {
  const selection = state.selection
  if (!selection) return storey.name
  if (selection.kind === "wall") {
    const wall = storey.walls.find((item) => item.id === selection.id)
    return wall ? WALL_TYPE_LABELS[wall.type] : "Vegg"
  }
  if (selection.kind === "opening") {
    const opening = storey.walls
      .flatMap((wall) => wall.openings)
      .find((item) => item.id === selection.id)
    return opening ? OPENING_LABELS[opening.kind] : "Åpning"
  }
  if (selection.kind === "slab") return "Dekke"
  if (selection.kind === "roof") return "Tak"
  if (selection.kind === "column") return "Søyle"
  if (selection.kind === "space") {
    return storey.spaces.find((item) => item.id === selection.id)?.name ?? "Rom"
  }
  return storey.name
}

// ---------------------------------------------------------------------------
// Felter
// ---------------------------------------------------------------------------

/**
 * Tallfelt som lar brukeren skrive fritt (inkludert komma og halvferdige tall)
 * uten at verdien hopper tilbake mens man skriver. Verdien sendes videre først
 * når feltet er et gyldig tall.
 */
function NumberField({
  label,
  value,
  onChange,
  unit,
  step = 1,
  min,
  max,
  scale = 1,
  decimals = 0,
  disabled,
  hint,
}: {
  label: string
  value: number
  onChange: (value: number) => void
  unit: string
  step?: number
  min?: number
  max?: number
  /** Ganges opp for visning (1000 = vis meter som millimeter). */
  scale?: number
  decimals?: number
  disabled?: boolean
  hint?: string
}) {
  const display = (value * scale).toFixed(decimals)
  const [draft, setDraft] = React.useState(display)
  const [focused, setFocused] = React.useState(false)

  React.useEffect(() => {
    if (!focused) setDraft(display)
  }, [display, focused])

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="relative">
        <Input
          type="text"
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setDraft(display)
          }}
          onChange={(event) => {
            setDraft(event.target.value)
            const parsed = Number(event.target.value.replace(",", "."))
            if (!Number.isFinite(parsed)) return
            let next = parsed / scale
            if (min !== undefined) next = Math.max(next, min)
            if (max !== undefined) next = Math.min(next, max)
            onChange(next)
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
            event.preventDefault()
            const direction = event.key === "ArrowUp" ? 1 : -1
            const increment = (event.shiftKey ? step * 10 : step) * direction
            let next = value + increment / scale
            if (min !== undefined) next = Math.max(next, min)
            if (max !== undefined) next = Math.min(next, max)
            onChange(next)
            setDraft((next * scale).toFixed(decimals))
          }}
          className="pr-12 tabular-nums"
        />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          {unit}
        </span>
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

function MaterialSelect({
  label,
  materials,
  value,
  onChange,
  filter,
}: {
  label: string
  materials: CadMaterial[]
  value: string | null | undefined
  onChange: (value: string | null) => void
  filter?: CadMaterial["category"][]
}) {
  const options = filter
    ? materials.filter((material) => filter.includes(material.category))
    : materials

  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Select
        value={value ?? "__none__"}
        onValueChange={(next) => onChange(next === "__none__" ? null : next)}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Ikke valgt" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">Ikke valgt</SelectItem>
          {options.map((material) => (
            <SelectItem key={material.id} value={material.id}>
              <span className="flex items-center gap-2">
                <span
                  className="inline-block size-3 shrink-0 rounded-sm border"
                  style={{ backgroundColor: material.color }}
                />
                {material.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Raske rotasjonsknapper. 90° for å snu, 15° for finjustering. */
function RotateRow({ store, label = "Roter" }: { store: CadStore; label?: string }) {
  const steps = [-90, -15, 15, 90]
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="grid grid-cols-4 gap-1">
        {steps.map((step) => (
          <Button
            key={step}
            variant="outline"
            size="sm"
            className="h-8 px-0 text-xs tabular-nums"
            onClick={() => store.rotateSelection(step)}
          >
            {step > 0 ? `+${step}°` : `${step}°`}
          </Button>
        ))}
      </div>
    </div>
  )
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------

function StoreyFields({ store, storey }: { store: CadStore; storey: Storey }) {
  const state = useCadState(store)

  return (
    <div className="space-y-6">
      <FieldGroup title="Etasje">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Navn</Label>
          <Input
            value={storey.name}
            onChange={(event) => store.updateStorey(storey.id, { name: event.target.value })}
          />
        </div>
        <NumberField
          label="Gulvnivå over terreng"
          value={storey.elevation}
          onChange={(value) => store.updateStorey(storey.id, { elevation: value })}
          unit="mm"
          scale={1000}
          step={100}
        />
        <NumberField
          label="Romhøyde"
          value={storey.height}
          onChange={(value) => store.updateStorey(storey.id, { height: value })}
          unit="mm"
          scale={1000}
          step={100}
          min={0.5}
          hint="Nye vegger får denne høyden."
        />
      </FieldGroup>

      <Separator />

      <FieldGroup title="Nøkkeltall">
        <ReadOnlyRow label="Vegger" value={String(storey.walls.length)} />
        <ReadOnlyRow label="Rom" value={String(storey.spaces.length)} />
        <ReadOnlyRow
          label="Dører / vinduer"
          value={`${storey.walls.reduce(
            (sum, wall) => sum + wall.openings.filter((item) => item.kind === "door").length,
            0
          )} / ${storey.walls.reduce(
            (sum, wall) => sum + wall.openings.filter((item) => item.kind === "window").length,
            0
          )}`}
        />
      </FieldGroup>

      <Separator />

      <FieldGroup title="Roter hele etasjen">
        <div className="grid grid-cols-4 gap-1">
          {[-90, -15, 15, 90].map((step) => (
            <Button
              key={step}
              variant="outline"
              size="sm"
              className="h-8 px-0 text-xs tabular-nums"
              onClick={() => store.rotateStorey(step)}
            >
              {step > 0 ? `+${step}°` : `${step}°`}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Snur alt i etasjen samlet — nyttig når bygget skal rettes inn mot tomta.
        </p>
      </FieldGroup>

      <Separator />

      <FieldGroup title="Rutenett">
        <NumberField
          label="Snapp til rutenett"
          value={state.model.meta.gridSize}
          onChange={(value) =>
            store.update(
              (model) => ({ ...model, meta: { ...model.meta, gridSize: value } }),
              { skipRooms: true }
            )
          }
          unit="mm"
          scale={1000}
          step={10}
          min={0.01}
          max={5}
        />
      </FieldGroup>

      {storey.spaces.length === 0 && (
        <p className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground">
          Tegn vegger som lukker seg rundt et areal, så finner ProAnbud rommene automatisk
          og regner ut arealene.
        </p>
      )}
    </div>
  )
}

function WallFields({
  store,
  storey,
  wallId,
}: {
  store: CadStore
  storey: Storey
  wallId: string
}) {
  const state = useCadState(store)
  const wall = storey.walls.find((item) => item.id === wallId)
  if (!wall) return null

  const length = wallLength(wall)

  return (
    <div className="space-y-6">
      <FieldGroup title="Vegg">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select
            value={wall.type}
            onValueChange={(next) =>
              store.updateWall(wallId, {
                type: next as WallType,
                thickness: WALL_TYPE_THICKNESS[next as WallType],
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(WALL_TYPE_LABELS) as WallType[]).map((type) => (
                <SelectItem key={type} value={type}>
                  {WALL_TYPE_LABELS[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <NumberField
          label="Lengde (senterlinje)"
          value={length}
          onChange={(next) => {
            // Strekk veggen fra startpunktet, behold retningen.
            const dx = wall.b.x - wall.a.x
            const dy = wall.b.y - wall.a.y
            const current = Math.hypot(dx, dy) || 1
            const factor = Math.max(next, 0.05) / current
            store.updateWall(wallId, {
              b: { x: wall.a.x + dx * factor, y: wall.a.y + dy * factor },
            })
          }}
          unit="mm"
          scale={1000}
          step={100}
          min={0.05}
        />
        <NumberField
          label="Retning"
          value={(() => {
            const degrees = (Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) * 180) / Math.PI
            return ((degrees % 360) + 360) % 360
          })()}
          onChange={(value) => store.setWallAngle(wallId, value)}
          unit="°"
          step={15}
          hint="0° peker mot øst. Veggen dreier om startpunktet."
        />
        <RotateRow store={store} label="Roter om midten" />
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Tykkelse"
            value={wall.thickness}
            onChange={(value) => store.updateWall(wallId, { thickness: value })}
            unit="mm"
            scale={1000}
            step={10}
            min={0.01}
          />
          <NumberField
            label="Høyde"
            value={wall.height}
            onChange={(value) => store.updateWall(wallId, { height: value })}
            unit="mm"
            scale={1000}
            step={100}
            min={0.1}
          />
        </div>
        <NumberField
          label="Bunn over gulv"
          value={wall.baseOffset}
          onChange={(value) => store.updateWall(wallId, { baseOffset: value })}
          unit="mm"
          scale={1000}
          step={50}
        />
      </FieldGroup>

      <Separator />

      <FieldGroup title="Plassering">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Start X"
            value={wall.a.x}
            onChange={(value) => store.updateWall(wallId, { a: { ...wall.a, x: value } })}
            unit="mm"
            scale={1000}
            step={100}
          />
          <NumberField
            label="Start Y"
            value={wall.a.y}
            onChange={(value) => store.updateWall(wallId, { a: { ...wall.a, y: value } })}
            unit="mm"
            scale={1000}
            step={100}
          />
          <NumberField
            label="Slutt X"
            value={wall.b.x}
            onChange={(value) => store.updateWall(wallId, { b: { ...wall.b, x: value } })}
            unit="mm"
            scale={1000}
            step={100}
          />
          <NumberField
            label="Slutt Y"
            value={wall.b.y}
            onChange={(value) => store.updateWall(wallId, { b: { ...wall.b, y: value } })}
            unit="mm"
            scale={1000}
            step={100}
          />
        </div>
      </FieldGroup>

      <Separator />

      <FieldGroup title="Materialer">
        <MaterialSelect
          label="Konstruksjon"
          materials={state.model.materials}
          value={wall.materialId}
          onChange={(value) => store.updateWall(wallId, { materialId: value })}
        />
        <MaterialSelect
          label="Utvendig overflate"
          materials={state.model.materials}
          value={wall.exteriorMaterialId}
          onChange={(value) => store.updateWall(wallId, { exteriorMaterialId: value })}
          filter={["wall", "other"]}
        />
        <MaterialSelect
          label="Innvendig overflate"
          materials={state.model.materials}
          value={wall.interiorMaterialId}
          onChange={(value) => store.updateWall(wallId, { interiorMaterialId: value })}
          filter={["wall", "other"]}
        />
        <p className="text-[11px] text-muted-foreground">
          Innvendig overflate regnes på begge sider av en innervegg, og bare innsiden av en
          yttervegg.
        </p>
      </FieldGroup>

      <Separator />

      <FieldGroup title="Åpninger i denne veggen">
        {wall.openings.length === 0 && (
          <p className="text-xs text-muted-foreground">
            Ingen. Velg dør- eller vindusverktøyet og klikk på veggen.
          </p>
        )}
        <div className="space-y-1">
          {wall.openings.map((opening) => (
            <button
              key={opening.id}
              type="button"
              onClick={() =>
                store.setSelection({
                  kind: "opening",
                  id: opening.id,
                  wallId,
                  storeyId: storey.id,
                })
              }
              className="flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span>{opening.label || OPENING_LABELS[opening.kind]}</span>
              <span className="tabular-nums text-muted-foreground">
                {Math.round(opening.width * 1000)}×{Math.round(opening.height * 1000)}
              </span>
            </button>
          ))}
        </div>
      </FieldGroup>

      <Separator />

      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => store.updateWall(wallId, { locked: !wall.locked })}
        >
          {wall.locked ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
          {wall.locked ? "Låst" : "Lås"}
        </Button>
        <Button variant="destructive" size="sm" className="flex-1" onClick={() => store.deleteWall(wallId)}>
          <Trash2 className="size-4" />
          Slett
        </Button>
      </div>
    </div>
  )
}

function OpeningFields({
  store,
  storey,
  wallId,
  openingId,
}: {
  store: CadStore
  storey: Storey
  wallId: string
  openingId: string
}) {
  const state = useCadState(store)
  const wall = storey.walls.find((item) => item.id === wallId)
  const opening = wall?.openings.find((item) => item.id === openingId)
  if (!wall || !opening) return null

  const maxDistance = wallLength(wall)

  return (
    <div className="space-y-6">
      <FieldGroup title="Åpning">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select
            value={opening.kind}
            onValueChange={(next) =>
              store.updateOpening(wallId, openingId, { kind: next as OpeningKind })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(OPENING_LABELS) as OpeningKind[]).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {OPENING_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Merking</Label>
          <Input
            value={opening.label ?? ""}
            placeholder="F.eks. V01 eller Ytterdør"
            onChange={(event) =>
              store.updateOpening(wallId, openingId, { label: event.target.value || null })
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Bredde"
            value={opening.width}
            onChange={(value) => store.updateOpening(wallId, openingId, { width: value })}
            unit="mm"
            scale={1000}
            step={50}
            min={0.05}
          />
          <NumberField
            label="Høyde"
            value={opening.height}
            onChange={(value) => store.updateOpening(wallId, openingId, { height: value })}
            unit="mm"
            scale={1000}
            step={50}
            min={0.05}
          />
        </div>
        <NumberField
          label="Brystningshøyde"
          value={opening.sill}
          onChange={(value) => store.updateOpening(wallId, openingId, { sill: value })}
          unit="mm"
          scale={1000}
          step={50}
          min={0}
          hint="0 for dør."
        />
        <NumberField
          label="Avstand fra veggstart"
          value={opening.distance}
          onChange={(value) => store.updateOpening(wallId, openingId, { distance: value })}
          unit="mm"
          scale={1000}
          step={100}
          min={0}
          max={maxDistance}
        />
      </FieldGroup>

      <Separator />

      <FieldGroup title="Produkt">
        <MaterialSelect
          label="Vare"
          materials={state.model.materials}
          value={opening.materialId}
          onChange={(value) => store.updateOpening(wallId, openingId, { materialId: value })}
          filter={["opening", "other"]}
        />
      </FieldGroup>

      <Button
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={() => store.deleteOpening(wallId, openingId)}
      >
        <Trash2 className="size-4" />
        Slett åpning
      </Button>
    </div>
  )
}

function SlabFields({
  store,
  storey,
  slabId,
}: {
  store: CadStore
  storey: Storey
  slabId: string
}) {
  const state = useCadState(store)
  const slab = storey.slabs.find((item) => item.id === slabId)
  if (!slab) return null

  return (
    <div className="space-y-6">
      <FieldGroup title="Dekke">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Type</Label>
          <Select
            value={slab.kind}
            onValueChange={(next) => store.updateSlab(slabId, { kind: next as SlabKind })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SLAB_LABELS) as SlabKind[]).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {SLAB_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <NumberField
          label="Tykkelse"
          value={slab.thickness}
          onChange={(value) => store.updateSlab(slabId, { thickness: value })}
          unit="mm"
          scale={1000}
          step={10}
          min={0.01}
        />
        <NumberField
          label="Overkant over gulvnivå"
          value={slab.offset}
          onChange={(value) => store.updateSlab(slabId, { offset: value })}
          unit="mm"
          scale={1000}
          step={50}
        />
        <ReadOnlyRow
          label="Areal"
          value={`${polygonArea(slab.outline).toFixed(1).replace(".", ",")} m²`}
        />
        <RotateRow store={store} />
      </FieldGroup>

      <Separator />

      <MaterialSelect
        label="Materiale"
        materials={state.model.materials}
        value={slab.materialId}
        onChange={(value) => store.updateSlab(slabId, { materialId: value })}
        filter={["floor", "structure", "other"]}
      />

      <Button variant="destructive" size="sm" className="w-full" onClick={() => store.deleteSlab(slabId)}>
        <Trash2 className="size-4" />
        Slett dekke
      </Button>
    </div>
  )
}

function RoofFields({
  store,
  storey,
  roofId,
}: {
  store: CadStore
  storey: Storey
  roofId: string
}) {
  const state = useCadState(store)
  const roof = storey.roofs.find((item) => item.id === roofId)
  if (!roof) return null

  return (
    <div className="space-y-6">
      <FieldGroup title="Tak">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Takform</Label>
          <Select
            value={roof.kind}
            onValueChange={(next) =>
              store.updateRoof(roofId, {
                kind: next as RoofKind,
                pitchDeg: next === "flat" ? 0 : roof.pitchDeg || 30,
              })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(ROOF_LABELS) as RoofKind[]).map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {ROOF_LABELS[kind]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <NumberField
          label="Takvinkel"
          value={roof.pitchDeg}
          onChange={(value) => store.updateRoof(roofId, { pitchDeg: value })}
          unit="°"
          step={1}
          min={0}
          max={75}
          disabled={roof.kind === "flat"}
        />
        <NumberField
          label={roof.kind === "gable" ? "Møneretning" : "Fallretning"}
          value={roof.directionDeg}
          onChange={(value) => store.updateRoof(roofId, { directionDeg: value })}
          unit="°"
          step={15}
          disabled={roof.kind === "flat"}
        />
        <NumberField
          label="Underkant tak over gulv"
          value={roof.baseHeight}
          onChange={(value) => store.updateRoof(roofId, { baseHeight: value })}
          unit="mm"
          scale={1000}
          step={100}
        />
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Konstruksjon"
            value={roof.thickness}
            onChange={(value) => store.updateRoof(roofId, { thickness: value })}
            unit="mm"
            scale={1000}
            step={10}
            min={0.02}
          />
          <NumberField
            label="Utstikk"
            value={roof.overhang}
            onChange={(value) => store.updateRoof(roofId, { overhang: value })}
            unit="mm"
            scale={1000}
            step={50}
            min={0}
          />
        </div>
        <RotateRow store={store} label="Roter taket" />
        <ReadOnlyRow
          label="Takflate"
          value={`${(
            polygonArea(roof.outline) / Math.cos((Math.min(roof.pitchDeg, 80) * Math.PI) / 180)
          )
            .toFixed(1)
            .replace(".", ",")} m²`}
        />
      </FieldGroup>

      <Separator />

      <MaterialSelect
        label="Taktekking"
        materials={state.model.materials}
        value={roof.materialId}
        onChange={(value) => store.updateRoof(roofId, { materialId: value })}
        filter={["roof", "other"]}
      />

      <Button variant="destructive" size="sm" className="w-full" onClick={() => store.deleteRoof(roofId)}>
        <Trash2 className="size-4" />
        Slett tak
      </Button>
    </div>
  )
}

function ColumnFields({
  store,
  storey,
  columnId,
}: {
  store: CadStore
  storey: Storey
  columnId: string
}) {
  const state = useCadState(store)
  const column = storey.columns.find((item) => item.id === columnId)
  if (!column) return null

  return (
    <div className="space-y-6">
      <FieldGroup title="Søyle">
        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Bredde"
            value={column.width}
            onChange={(value) => store.updateColumn(columnId, { width: value })}
            unit="mm"
            scale={1000}
            step={10}
            min={0.02}
          />
          <NumberField
            label="Dybde"
            value={column.depth}
            onChange={(value) => store.updateColumn(columnId, { depth: value })}
            unit="mm"
            scale={1000}
            step={10}
            min={0.02}
          />
        </div>
        <NumberField
          label="Høyde"
          value={column.height}
          onChange={(value) => store.updateColumn(columnId, { height: value })}
          unit="mm"
          scale={1000}
          step={100}
          min={0.1}
        />
        <NumberField
          label="Rotasjon"
          value={column.rotationDeg}
          onChange={(value) => store.updateColumn(columnId, { rotationDeg: value })}
          unit="°"
          step={15}
        />
        <RotateRow store={store} />
      </FieldGroup>

      <Separator />

      <MaterialSelect
        label="Materiale"
        materials={state.model.materials}
        value={column.materialId}
        onChange={(value) => store.updateColumn(columnId, { materialId: value })}
        filter={["structure", "other"]}
      />

      <Button
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={() => store.deleteColumn(columnId)}
      >
        <Trash2 className="size-4" />
        Slett søyle
      </Button>
    </div>
  )
}

function SpaceFields({
  store,
  storey,
  spaceId,
}: {
  store: CadStore
  storey: Storey
  spaceId: string
}) {
  const state = useCadState(store)
  const space = storey.spaces.find((item) => item.id === spaceId)
  if (!space) return null

  const area = polygonArea(space.outline)
  const perimeter = polygonPerimeter(space.outline)

  return (
    <div className="space-y-6">
      <FieldGroup title="Rom">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Navn</Label>
          <Input
            value={space.name}
            onChange={(event) => store.updateSpace(spaceId, { name: event.target.value })}
          />
        </div>
        <ReadOnlyRow label="Gulvareal" value={`${area.toFixed(2).replace(".", ",")} m²`} />
        <ReadOnlyRow label="Omkrets" value={`${perimeter.toFixed(2).replace(".", ",")} m`} />
        <ReadOnlyRow
          label="Veggflate"
          value={`${(perimeter * storey.height).toFixed(1).replace(".", ",")} m²`}
        />
      </FieldGroup>

      <Separator />

      <FieldGroup title="Overflater">
        <MaterialSelect
          label="Gulv"
          materials={state.model.materials}
          value={space.floorMaterialId}
          onChange={(value) => store.updateSpace(spaceId, { floorMaterialId: value })}
          filter={["floor", "other"]}
        />
        <MaterialSelect
          label="Vegger"
          materials={state.model.materials}
          value={space.wallMaterialId}
          onChange={(value) => store.updateSpace(spaceId, { wallMaterialId: value })}
          filter={["wall", "other"]}
        />
        <MaterialSelect
          label="Himling"
          materials={state.model.materials}
          value={space.ceilingMaterialId}
          onChange={(value) => store.updateSpace(spaceId, { ceilingMaterialId: value })}
          filter={["wall", "other"]}
        />
      </FieldGroup>

      <p className="rounded-md bg-muted/60 p-3 text-[11px] text-muted-foreground">
        Rommet oppdateres automatisk når du flytter veggene. Navnet du gir det følger med.
      </p>
    </div>
  )
}

export type { MaterialSlot }
