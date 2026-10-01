"use client"

/**
 * Materialkostnadene på prosjektet — én liste for alt: det som er bokført i
 * regnskapet (Fiken/Tripletex, kommer inn av seg selv) og det håndverkeren legger
 * inn selv før fakturaen er bokført.
 *
 * Samme kjøp skal telles én gang: når en manuell post blir funnet igjen som
 * bokført kostnad, vises den under den bokførte raden i stedet for som egen rad,
 * og den teller ikke. «Ikke samme kjøp?» løsner koblingen.
 */

import * as React from "react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowLeft, Check, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InfoHint } from "@/components/ui/info-hint"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { actionErrorMessage, reportClientError } from "@/lib/errors/client"
import type { MaterialCost, MaterialCostSummary, MaterialCostSync } from "@/lib/job-costing/types"
import type { SearchMaterial } from "@/lib/tilbud/company-price-utils"
import { formatNok } from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"

import { getAccountingProviderAction, type AccountingProvider } from "./fakturering-actions"
import {
  addMaterialCostAction,
  deleteMaterialCostAction,
  pullAccountingCostsAction,
  unlinkMaterialCostAction,
} from "./job-costing-actions"

const PROVIDER_LABELS: Record<string, string> = { fiken: "Fiken", tripletex: "Tripletex" }
/** Flere rader enn dette skjules bak «Vis alle», så kortet ikke blir en hovedbok. */
const COLLAPSED_COUNT = 8

function formatDate(value: string | null) {
  if (!value) return null
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })
}

function formatPulledAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString("nb-NO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

/**
 * Hvor posten står i regnskapet. Manuelle poster går som kladd til regnskapet;
 * når kjøpet bokføres kommer det tilbake som «Bokført» og den manuelle forsvinner
 * under den.
 */
function SourceChip({ cost, system }: { cost: MaterialCost; system: string | null }) {
  const where = system ?? "regnskapet"
  const state =
    cost.source !== "manual"
      ? { dot: "bg-emerald-600", label: "Bokført", title: `Bokført i ${PROVIDER_LABELS[cost.source] ?? "regnskapet"}` }
      : cost.accounting_status === "draft"
        ? { dot: "bg-sky-600", label: `Kladd i ${where}`, title: `Ligger som kladd i ${where} til den er bokført` }
        : cost.accounting_status === "pending"
          ? { dot: "bg-muted-foreground", label: `Sendes til ${where}`, title: undefined }
          : cost.accounting_status === "failed"
            ? {
                dot: "bg-destructive",
                label: "Ikke sendt",
                title: cost.accounting_error
                  ? `Kunne ikke sendes til ${where}: ${cost.accounting_error}`
                  : `Kunne ikke sendes til ${where}`,
              }
            : { dot: "bg-amber-600", label: "Ikke bokført ennå", title: undefined }
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      title={state.title}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", state.dot)} />
      {state.label}
    </span>
  )
}

function costTitle(cost: MaterialCost) {
  return cost.supplier_name || cost.description || cost.account_name || "Materialkost"
}

function costMeta(cost: MaterialCost) {
  const booked = cost.source !== "manual"
  return [
    cost.supplier_name && cost.description ? cost.description : null,
    booked ? [cost.account_number, cost.account_name].filter(Boolean).join(" ") || null : null,
    booked
      ? cost.voucher_ref
        ? `${PROVIDER_LABELS[cost.source] ?? "Regnskap"} bilag ${cost.voucher_ref}`
        : PROVIDER_LABELS[cost.source] ?? null
      : cost.invoice_ref
        ? `Faktura ${cost.invoice_ref}`
        : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

export function MaterialCostsCard({
  projectId,
  canManage,
  costs,
  summary,
  costSync,
  onChanged,
}: {
  projectId: string
  canManage: boolean
  costs: MaterialCost[]
  summary: MaterialCostSummary
  costSync: MaterialCostSync | null
  onChanged: () => void
}) {
  const confirm = useConfirm()
  const [provider, setProvider] = useState<AccountingProvider>(costSync?.provider ?? null)
  const [pulling, setPulling] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAccountingProviderAction(projectId)
      .then((value) => {
        if (!cancelled) setProvider(value)
      })
      .catch(() => {
        // Uten svar viser vi det vi vet fra forrige henting — ingen feilmelding
        // for noe brukeren ikke har bedt om.
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  // Manuelle poster som er bokført vises under den bokførte raden, ikke som egne rader.
  const { rows, replacedBy } = useMemo(() => {
    const replaced = new Map<string, MaterialCost[]>()
    const visibleRows: MaterialCost[] = []
    for (const cost of costs) {
      if (cost.source === "manual" && cost.replaced_by) {
        replaced.set(cost.replaced_by, [...(replaced.get(cost.replaced_by) ?? []), cost])
      } else {
        visibleRows.push(cost)
      }
    }
    // En kobling til en rad vi ikke har (skal ikke skje, FK nuller den) vises som vanlig rad.
    const known = new Set(visibleRows.map((cost) => cost.id))
    for (const [bookedId, manual] of replaced) {
      if (!known.has(bookedId)) {
        visibleRows.push(...manual)
        replaced.delete(bookedId)
      }
    }
    return { rows: visibleRows, replacedBy: replaced }
  }, [costs])

  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT)
  const total = summary.bookedNok + summary.manualNok
  const bookedCount = rows.filter((cost) => cost.source !== "manual").length
  const manualCount = rows.length - bookedCount
  const system = PROVIDER_LABELS[provider ?? costSync?.provider ?? ""] ?? null
  const pulledAt = costSync ? formatPulledAt(costSync.pulledAt) : null

  async function handlePull() {
    setPulling(true)
    try {
      const result = await pullAccountingCostsAction(projectId)
      onChanged()
      if (result.completed) toast.success(`Kostnader og inntekter er hentet fra ${system ?? "regnskapet"}`)
      else toast.info(`${system ?? "Regnskapet"} er opptatt — tallene kommer om litt`)
    } catch (error) {
      reportClientError(error, { context: { action: "hente kostnader fra regnskapet", projectId } })
      toast.error(actionErrorMessage(error, "Kunne ikke hente fra regnskapet"))
    } finally {
      setPulling(false)
    }
  }

  async function handleDelete(cost: MaterialCost) {
    const ok = await confirm({
      title: "Slette materialkosten?",
      description: "Kostnaden fjernes fra prosjektets lønnsomhet.",
      confirmText: "Slett",
      variant: "destructive",
    })
    if (!ok) return
    try {
      await deleteMaterialCostAction({ projectId, id: cost.id })
      onChanged()
    } catch (error) {
      reportClientError(error, { context: { action: "slette materialkost", projectId, id: cost.id } })
      toast.error(actionErrorMessage(error, "Kunne ikke slette"))
    }
  }

  async function handleUnlink(cost: MaterialCost) {
    try {
      await unlinkMaterialCostAction({ projectId, id: cost.id })
      toast.success("Posten telles nå for seg selv")
      onChanged()
    } catch (error) {
      reportClientError(error, { context: { action: "løsne materialkost", projectId, id: cost.id } })
      toast.error(actionErrorMessage(error, "Kunne ikke endre posten"))
    }
  }

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-sm font-medium">Materialkostnader</p>
            <InfoHint title="Materialkostnader">
              <p>Innkjøp, underentreprenører og andre direkte kostnader på prosjektet, eks. mva.</p>
              {system ? (
                <>
                  <p>
                    Det som er bokført på prosjektet i {system} kommer inn av seg selv hver natt. Legg inn
                    det som ikke er bokført ennå, så stemmer dekningsgraden underveis.
                  </p>
                  <p>
                    Det du legger inn her sendes til {system} som kladd, så regnskapsføreren kan bokføre
                    det. Når kjøpet er bokført, kobles det til posten din og telles én gang — også om
                    leverandørfakturaen ble bokført i stedet for kladden.
                  </p>
                  <p>Lønn og kjørebokas reiseregninger hentes ikke — de regnes fra timene og kjøreboka.</p>
                </>
              ) : (
                <p>
                  Registrer det du faktisk har betalt leverandøren. Uten poster her regnes materialkosten
                  som 0 kr, og dekningsgraden blir høyere enn den er.
                </p>
              )}
            </InfoHint>
          </div>
          <p className="text-xs text-muted-foreground">
            {system
              ? pulledAt
                ? `Hentet fra ${system} ${pulledAt}`
                : `Hentes fra ${system} første gang i natt`
              : "Faktiske innkjøp, eks. mva"}
          </p>
        </div>
        {canManage ? (
          <div className="flex items-center gap-2">
            {provider ? (
              <Button size="sm" variant="outline" className="h-8" onClick={handlePull} disabled={pulling}>
                {pulling ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1.5 size-4" />
                )}
                {pulling ? "Henter …" : "Hent nå"}
              </Button>
            ) : null}
            <Button size="sm" className="h-8" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1.5 size-4" />
              Legg til
            </Button>
          </div>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          {system
            ? `Ingen kostnader bokført på prosjektet i ${system} ennå. Legg inn innkjøp som ikke er bokført.`
            : "Ingen materialkostnader registrert ennå."}
        </p>
      ) : (
        <>
          <ul className="divide-y">
            {visible.map((cost) => {
              const replaced = replacedBy.get(cost.id) ?? []
              const amount = Number(cost.amount_nok)
              return (
                <li
                  key={cost.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[64px_minmax(0,1fr)_auto_112px_32px]"
                >
                  <span className="hidden text-sm text-muted-foreground sm:block">
                    {formatDate(cost.cost_date) ?? "—"}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{costTitle(cost)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {/* Mobil har ingen datokolonne: datoen står først i undertittelen. */}
                      <span className="sm:hidden">
                        {[formatDate(cost.cost_date), costMeta(cost)].filter(Boolean).join(" · ")}
                      </span>
                      <span className="hidden sm:inline">{costMeta(cost)}</span>
                    </p>
                    {replaced.map((manual) => (
                      <p
                        key={manual.id}
                        className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"
                      >
                        <Check className="size-3" aria-hidden />
                        Erstatter manuell post på {formatNok(Number(manual.amount_nok))}
                        {manual.cost_date ? ` fra ${formatDate(manual.cost_date)}` : ""}
                        {canManage ? (
                          <button
                            type="button"
                            onClick={() => handleUnlink(manual)}
                            className="font-medium underline underline-offset-2 hover:text-foreground"
                          >
                            Ikke samme kjøp?
                          </button>
                        ) : null}
                      </p>
                    ))}
                  </div>
                  <span className="hidden sm:block">
                    <SourceChip cost={cost} system={system} />
                  </span>
                  <span
                    className={cn(
                      "text-right text-sm font-medium tabular-nums",
                      amount < 0 && "text-emerald-700 dark:text-emerald-400"
                    )}
                  >
                    {formatNok(amount)}
                  </span>
                  <span className="col-span-2 flex items-center justify-between sm:col-span-1 sm:justify-end">
                    <span className="sm:hidden">
                      <SourceChip cost={cost} system={system} />
                    </span>
                    {canManage && cost.source === "manual" ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        onClick={() => handleDelete(cost)}
                        aria-label="Slett materialkost"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
          {rows.length > COLLAPSED_COUNT ? (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="w-full border-t px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              {expanded ? "Vis færre" : `Vis alle ${rows.length}`}
            </button>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-4 py-2.5 text-sm">
            <span className="font-medium">
              Sum materialer
              {system ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {bookedCount} bokført · {manualCount} ikke bokført
                </span>
              ) : null}
            </span>
            <span className="font-semibold tabular-nums">{formatNok(total)}</span>
          </div>
        </>
      )}

      {canManage ? (
        <AddMaterialCostDialog
          projectId={projectId}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onAdded={onChanged}
        />
      ) : null}
    </div>
  )
}

/** «Legg til»: fra bedriftens prisfiler eller skrevet inn for hånd. */
function AddMaterialCostDialog({
  projectId,
  open,
  onOpenChange,
  onAdded,
}: {
  projectId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<"prisliste" | "manuelt">("prisliste")
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<SearchMaterial[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<SearchMaterial | null>(null)
  const [quantity, setQuantity] = useState("1")
  const [form, setForm] = useState({
    amountNok: "",
    supplierName: "",
    description: "",
    invoiceRef: "",
    costDate: "",
  })

  const debouncedQuery = useDebouncedValue(query, 250)

  const reset = useCallback(() => {
    setMode("prisliste")
    setQuery("")
    setResults([])
    setSelected(null)
    setQuantity("1")
    setForm({ amountNok: "", supplierName: "", description: "", invoiceRef: "", costDate: "" })
  }, [])

  // Samme endepunkt som materialsøket i tilbudsbyggeren, så bedriftens prisfiler
  // er ett søk unna også her.
  useEffect(() => {
    if (!open || mode !== "prisliste" || selected) return

    let cancelled = false
    setSearching(true)

    void (async () => {
      try {
        const params = new URLSearchParams({ type: "material", limit: "12" })
        if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim())

        const response = await fetch(`/api/mine-priser/sok?${params.toString()}`)
        const payload = await response.json()
        if (!response.ok) throw new Error(payload.error || "Kunne ikke søke i prisliste")

        if (!cancelled) setResults(payload.materials || [])
      } catch (error) {
        reportClientError(error, { level: "warning", context: { action: "search material prices for cost" } })
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setSearching(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [debouncedQuery, mode, open, selected])

  function selectMaterial(material: SearchMaterial) {
    setSelected(material)
    setQuantity("1")
    setForm((f) => ({
      ...f,
      supplierName: material.supplier,
      description: material.product,
      amountNok: material.unitPriceNok > 0 ? String(material.unitPriceNok) : f.amountNok,
    }))
  }

  function updateQuantity(value: string) {
    setQuantity(value)
    if (!selected) return
    const qty = Number(value.replace(",", "."))
    if (!Number.isFinite(qty) || qty <= 0) return
    setForm((f) => ({ ...f, amountNok: String(Math.round(qty * selected.unitPriceNok * 100) / 100) }))
  }

  async function handleAdd() {
    const amount = Number(form.amountNok.replace(/\s/g, "").replace(",", "."))
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Skriv inn et gyldig beløp")
      return
    }
    setSaving(true)
    try {
      const result = await addMaterialCostAction({
        projectId,
        amountNok: amount,
        supplierName: form.supplierName,
        description: form.description,
        invoiceRef: form.invoiceRef,
        costDate: form.costDate || undefined,
      })
      reset()
      onOpenChange(false)
      onAdded()
      toast.success(
        result?.linked
          ? "Lagt til — kjøpet er allerede bokført, så det telles én gang"
          : result?.sentTo
            ? `Lagt til — sendes til ${PROVIDER_LABELS[result.sentTo] ?? "regnskapet"} som kladd`
            : "Materialkost lagt til"
      )
    } catch (error) {
      reportClientError(error, { context: { action: "legge til materialkost", projectId } })
      toast.error(actionErrorMessage(error, "Kunne ikke lagre"))
    } finally {
      setSaving(false)
    }
  }

  const resultsEmptyLabel = searching
    ? "Søker..."
    : debouncedQuery.trim()
      ? "Ingen treff i prislisten"
      : "Skriv for å søke blant materialer"

  const detailFields = (suffix: string) => (
    <>
      <div>
        <Label htmlFor={`mc-supplier${suffix}`}>Leverandør</Label>
        <Input
          id={`mc-supplier${suffix}`}
          value={form.supplierName}
          onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))}
        />
      </div>
      <div>
        <Label htmlFor={`mc-desc${suffix}`}>Beskrivelse</Label>
        <Input
          id={`mc-desc${suffix}`}
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`mc-ref${suffix}`}>Fakturanr.</Label>
          <Input
            id={`mc-ref${suffix}`}
            value={form.invoiceRef}
            onChange={(e) => setForm((f) => ({ ...f, invoiceRef: e.target.value }))}
          />
        </div>
        <div>
          <Label htmlFor={`mc-date${suffix}`}>Dato</Label>
          <DatePicker
            id={`mc-date${suffix}`}
            value={form.costDate}
            onChange={(value) => setForm((f) => ({ ...f, costDate: value }))}
            className="w-full"
          />
        </div>
      </div>
    </>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ny materialkost</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("prisliste")}
            className={cn(
              "rounded-md py-1.5 font-medium transition-colors",
              mode === "prisliste" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            Fra prisliste
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("manuelt")
              setSelected(null)
            }}
            className={cn(
              "rounded-md py-1.5 font-medium transition-colors",
              mode === "manuelt" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
          >
            Manuelt
          </button>
        </div>

        {mode === "prisliste" ? (
          selected ? (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{selected.product}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[selected.supplier, `${formatNok(selected.unitPriceNok)}/${selected.unit}`]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => setSelected(null)}
                >
                  <ArrowLeft className="mr-1 size-3.5" />
                  Bytt vare
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="mc-qty">Mengde ({selected.unit})</Label>
                  <Input
                    id="mc-qty"
                    inputMode="decimal"
                    value={quantity}
                    onChange={(e) => updateQuantity(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="mc-amount-picked">Beløp (kr, eks. mva) *</Label>
                  <Input
                    id="mc-amount-picked"
                    inputMode="decimal"
                    value={form.amountNok}
                    onChange={(e) => setForm((f) => ({ ...f, amountNok: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>
              {detailFields("-picked")}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Søk på produkt, NOBB, leverandør..."
                  className="pl-9"
                />
              </div>
              <div className="max-h-[280px] overflow-y-auto">
                {searching ? (
                  <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Søker...
                  </div>
                ) : results.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">{resultsEmptyLabel}</p>
                ) : (
                  <div className="space-y-1">
                    {results.map((material) => (
                      <button
                        key={material.id}
                        type="button"
                        onClick={() => selectMaterial(material)}
                        className="flex w-full items-start justify-between gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:border-border hover:bg-muted/50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{material.product}</p>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {[material.supplier, material.unit, material.category].filter(Boolean).join(" · ")}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold tabular-nums">
                          {formatNok(material.unitPriceNok)}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Finner du ikke varen?{" "}
                <button
                  type="button"
                  className="font-medium underline underline-offset-2"
                  onClick={() => setMode("manuelt")}
                >
                  Skriv den inn manuelt
                </button>
                .
              </p>
            </div>
          )
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor="mc-amount">Beløp (kr, eks. mva) *</Label>
              <Input
                id="mc-amount"
                inputMode="decimal"
                value={form.amountNok}
                onChange={(e) => setForm((f) => ({ ...f, amountNok: e.target.value }))}
                placeholder="0"
              />
            </div>
            {detailFields("")}
          </div>
        )}

        <DialogFooter>
          <Button onClick={handleAdd} disabled={saving || (mode === "prisliste" && !selected)}>
            {saving ? "Lagrer …" : "Legg til"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
