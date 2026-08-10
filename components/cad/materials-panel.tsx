"use client"

/**
 * Materialpanelet — koblingen mellom geometri og økonomi.
 *
 * Et materiale her er «det som ligger på denne flaten»: navn, enhet, hvordan
 * mengden måles (areal/lengde/volum/antall), svinn og eventuelt en vare fra
 * bedriftens egne prisfiler. Når materialet er tilordnet en vegg, et tak eller
 * et rom, faller mengden ut av seg selv i mengdepanelet — og videre inn i
 * tilbudet.
 */

import * as React from "react"
import { Loader2, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

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
import { MATERIAL_CATEGORY_LABELS } from "@/lib/cad/presets"
import type { CadStore } from "@/lib/cad/store"
import { useCadState } from "@/lib/cad/store"
import type { CadMaterial, MaterialCategory } from "@/lib/cad/types"
import { cn } from "@/lib/utils"

/**
 * Formen på treff fra /api/mine-priser/sok — det samme søket prisvelgeren i
 * tilbud bruker. Vi lager IKKE et eget søk her: det ene som finnes håndterer
 * allerede halvopplastede filer, rangering på tvers av produkt/NOBB/varenummer,
 * og fallback fra nettopris til listepris.
 */
type PriceRow = {
  id: string
  product: string
  unit: string
  unitPriceNok: number
  supplier: string
  nobb: string | null
  supplierSku: string | null
  category: string | null
}

const MEASURE_LABELS: Record<CadMaterial["measure"], string> = {
  area: "Areal (m²)",
  length: "Lengde (m)",
  volume: "Volum (m³)",
  count: "Antall (stk)",
}

const PALETTE = [
  "#c8bda9",
  "#eeece7",
  "#c69b6d",
  "#8fbcd4",
  "#6f6a63",
  "#9bb08a",
  "#b98a56",
  "#d7d3cc",
]

export function MaterialsPanel({ store, className }: { store: CadStore; className?: string }) {
  const state = useCadState(store)
  const [editingId, setEditingId] = React.useState<string | null>(null)

  const selectionLabel = describeSelection(state)

  return (
    <div className={cn("flex h-full flex-col", className)}>
      <div className="border-b px-4 py-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Materialer og varer
        </p>
        <p className="text-sm text-muted-foreground">
          {selectionLabel
            ? `Klikk «Legg på» for å tilordne til ${selectionLabel}.`
            : "Velg et element i tegningen for å tilordne."}
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <PriceFileSearch store={store} />

        <Separator />

        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            I modellen ({state.model.materials.length})
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const id = store.addMaterial({
                name: "Nytt materiale",
                category: "other",
                color: PALETTE[state.model.materials.length % PALETTE.length],
                unit: "m2",
                measure: "area",
                factor: 1,
                wastePercent: 0,
                supplier: null,
                nobb: null,
                supplierSku: null,
                unitPriceNok: null,
                notes: null,
              })
              setEditingId(id)
            }}
          >
            <Plus className="size-4" />
            Nytt
          </Button>
        </div>

        <div className="space-y-2">
          {state.model.materials.map((material) => (
            <MaterialCard
              key={material.id}
              store={store}
              material={material}
              expanded={editingId === material.id}
              onToggle={() =>
                setEditingId((current) => (current === material.id ? null : material.id))
              }
              canAssign={Boolean(state.selection)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function describeSelection(state: ReturnType<typeof useCadState>) {
  const selection = state.selection
  if (!selection) return null
  const labels: Record<string, string> = {
    wall: "veggen",
    opening: "åpningen",
    slab: "dekket",
    roof: "taket",
    column: "søylen",
    space: "rommet",
  }
  return labels[selection.kind] ?? "elementet"
}

function MaterialCard({
  store,
  material,
  expanded,
  onToggle,
  canAssign,
}: {
  store: CadStore
  material: CadMaterial
  expanded: boolean
  onToggle: () => void
  canAssign: boolean
}) {
  const state = useCadState(store)
  const selection = state.selection

  const slots = React.useMemo(() => {
    if (selection?.kind === "wall") {
      return [
        { slot: "main" as const, label: "Konstruksjon" },
        { slot: "exterior" as const, label: "Utvendig" },
        { slot: "interior" as const, label: "Innvendig" },
      ]
    }
    if (selection?.kind === "space") {
      return [
        { slot: "main" as const, label: "Gulv" },
        { slot: "interior" as const, label: "Vegger" },
        { slot: "ceiling" as const, label: "Himling" },
      ]
    }
    return [{ slot: "main" as const, label: "Legg på" }]
  }, [selection?.kind])

  return (
    <div className="rounded-lg border">
      <div className="flex items-center gap-2 p-2">
        <span
          className="size-6 shrink-0 rounded-md border"
          style={{ backgroundColor: material.color }}
        />
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
        >
          <p className="truncate text-sm font-medium">{material.name}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {MATERIAL_CATEGORY_LABELS[material.category]} · {material.unit}
            {material.unitPriceNok !== null && ` · ${material.unitPriceNok} kr`}
            {material.wastePercent > 0 && ` · ${material.wastePercent} % svinn`}
          </p>
        </button>
      </div>

      {canAssign && (
        <div className="flex flex-wrap gap-1 border-t px-2 py-1.5">
          {slots.map(({ slot, label }) => (
            <Button
              key={slot}
              size="sm"
              variant="secondary"
              className="h-7 text-xs"
              onClick={() => {
                store.assignMaterialToSelection(material.id, slot)
                toast.success(`${material.name} lagt på`)
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      )}

      {expanded && (
        <div className="space-y-3 border-t p-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Navn</Label>
            <Input
              value={material.name}
              onChange={(event) => store.updateMaterial(material.id, { name: event.target.value })}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Kategori</Label>
              <Select
                value={material.category}
                onValueChange={(next) =>
                  store.updateMaterial(material.id, { category: next as MaterialCategory })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MATERIAL_CATEGORY_LABELS) as MaterialCategory[]).map((category) => (
                    <SelectItem key={category} value={category}>
                      {MATERIAL_CATEGORY_LABELS[category]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Måles som</Label>
              <Select
                value={material.measure}
                onValueChange={(next) =>
                  store.updateMaterial(material.id, {
                    measure: next as CadMaterial["measure"],
                  })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MEASURE_LABELS) as CadMaterial["measure"][]).map((measure) => (
                    <SelectItem key={measure} value={measure}>
                      {MEASURE_LABELS[measure]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Enhet</Label>
              <Input
                value={material.unit}
                onChange={(event) =>
                  store.updateMaterial(material.id, { unit: event.target.value })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Svinn %</Label>
              <Input
                type="number"
                value={material.wastePercent}
                onChange={(event) =>
                  store.updateMaterial(material.id, {
                    wastePercent: Number(event.target.value) || 0,
                  })
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Pris/enhet</Label>
              <Input
                type="number"
                value={material.unitPriceNok ?? ""}
                placeholder="—"
                onChange={(event) =>
                  store.updateMaterial(material.id, {
                    unitPriceNok: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Enheter per målte enhet (f.eks. 0,5 plater per m²)
            </Label>
            <Input
              type="number"
              step="0.01"
              value={material.factor}
              onChange={(event) =>
                store.updateMaterial(material.id, { factor: Number(event.target.value) || 1 })
              }
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Farge i 3D</Label>
            <div className="flex flex-wrap gap-1">
              {PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  aria-label={`Velg farge ${color}`}
                  onClick={() => store.updateMaterial(material.id, { color })}
                  className={cn(
                    "size-7 rounded-md border-2",
                    material.color === color ? "border-primary" : "border-transparent"
                  )}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>

          {material.supplier && (
            <p className="text-[11px] text-muted-foreground">
              Fra prisfil: {material.supplier}
              {material.nobb && ` · NOBB ${material.nobb}`}
            </p>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="w-full text-destructive hover:text-destructive"
            onClick={() => store.deleteMaterial(material.id)}
          >
            <Trash2 className="size-4" />
            Fjern fra modellen
          </Button>
        </div>
      )}
    </div>
  )
}

function PriceFileSearch({ store }: { store: CadStore }) {
  const [query, setQuery] = React.useState("")
  const [rows, setRows] = React.useState<PriceRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [searched, setSearched] = React.useState(false)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setRows([])
      setSearched(false)
      setFailed(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(
          `/api/mine-priser/sok?q=${encodeURIComponent(trimmed)}&type=material&limit=25`,
          { signal: controller.signal }
        )
        if (!response.ok) throw new Error("Søk feilet")
        const data = (await response.json()) as { materials?: PriceRow[] }
        setRows(data.materials ?? [])
        setSearched(true)
        setFailed(false)
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          // Et mislykket søk er ikke det samme som null treff — å si «ingen
          // treff» ville sendt brukeren av gårde for å lete etter prisfiler
          // som finnes.
          setRows([])
          setSearched(true)
          setFailed(true)
        }
      } finally {
        setLoading(false)
      }
    }, 300)

    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [query])

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Hent fra prisfilene dine
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Søk etter produkt, f.eks. gipsplate"
          className="pl-9"
        />
        {loading && (
          <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {searched && rows.length === 0 && !loading && (
        <p className={cn("text-[11px]", failed ? "text-destructive" : "text-muted-foreground")}>
          {failed
            ? "Søket i prisfilene feilet. Sjekk nettforbindelsen og prøv igjen."
            : "Ingen treff. Last opp prisfiler under Mine priser, eller lag materialet manuelt."}
        </p>
      )}

      {rows.length > 0 && (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1">
          {rows.map((row, index) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                store.addMaterial({
                  name: row.product,
                  category: guessCategory(row.product),
                  color: PALETTE[index % PALETTE.length],
                  unit: normalizeUnit(row.unit),
                  measure: guessMeasure(row.unit),
                  factor: 1,
                  wastePercent: 10,
                  supplier: row.supplier,
                  nobb: row.nobb,
                  supplierSku: row.supplierSku,
                  // Søket gir 0 når verken netto- eller listepris finnes.
                  unitPriceNok: row.unitPriceNok > 0 ? row.unitPriceNok : null,
                  notes: null,
                })
                toast.success(`${row.product} lagt til i modellen`)
              }}
              className="flex w-full items-start justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{row.product}</span>
                <span className="block truncate text-muted-foreground">
                  {row.supplier || "Prisfil"}
                  {row.nobb && ` · NOBB ${row.nobb}`}
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {row.unitPriceNok > 0 ? `${Math.round(row.unitPriceNok)} kr` : "—"}
                {row.unit ? `/${row.unit}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function normalizeUnit(unit: string | null | undefined) {
  const value = (unit || "stk").trim().toLowerCase()
  if (value === "m²" || value === "kvm") return "m2"
  if (value === "meter") return "m"
  return value
}

function guessMeasure(unit: string | null | undefined): CadMaterial["measure"] {
  const value = normalizeUnit(unit)
  if (value === "m2") return "area"
  if (value === "m" || value === "lm") return "length"
  if (value === "m3") return "volume"
  return "count"
}

function guessCategory(product: string): MaterialCategory {
  const value = product.toLowerCase()
  if (/(takstein|shingel|takpapp|undertak|takrenne)/.test(value)) return "roof"
  if (/(parkett|laminat|flis|belegg|gulv)/.test(value)) return "floor"
  if (/(vindu|dør|karm)/.test(value)) return "opening"
  if (/(bjelke|stender|limtre|betong|søyle|stål)/.test(value)) return "structure"
  if (/(gips|kledning|panel|isolasjon|plate)/.test(value)) return "wall"
  return "other"
}
