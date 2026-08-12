"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { reportClientError } from "@/lib/errors/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InfoHint } from "@/components/ui/info-hint"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type HourlyRate = {
  id: string
  job_type: string
  hourly_rate_nok: number
  /** Selvkost per time. `null` = ikke satt, som IKKE er det samme som 0 kr. */
  cost_rate_nok: number | null
  sort_order: number
  created_at: string
  updated_at: string
}

const RATE_SUGGESTIONS = [
  "Tømrerarbeid",
  "Byggingeniør",
  "Murerarbeid",
  "Elektriker",
  "Rørlegger",
  "Maler",
  "Grunnarbeid",
  "Prosjektledelse",
]

function formatRate(value: number) {
  return `${Math.round(value).toLocaleString("no-NO")} kr/t`
}

/** Dekningsgrad på selve timen: hvor mye av salgsprisen som er igjen etter selvkost. */
function marginPercent(rate: HourlyRate) {
  if (rate.cost_rate_nok === null || rate.hourly_rate_nok <= 0) return null
  return Math.round(((rate.hourly_rate_nok - rate.cost_rate_nok) / rate.hourly_rate_nok) * 100)
}

function parseRateInput(value: string) {
  const normalized = value.replace(/\s/g, "").replace(",", ".")
  const parsed = Number.parseFloat(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

export function TimepriserPage() {
  const [rates, setRates] = useState<HourlyRate[]>([])
  const [search, setSearch] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingRate, setEditingRate] = useState<HourlyRate | null>(null)
  const [rateToDelete, setRateToDelete] = useState<HourlyRate | null>(null)
  const [jobType, setJobType] = useState("")
  const [rateInput, setRateInput] = useState("")
  const [costInput, setCostInput] = useState("")

  const loadRates = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch("/api/mine-priser/timepriser")
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Kunne ikke hente timepriser")
      }
      setRates(data.rates ?? [])
    } catch (error) {
      console.error(error)
      reportClientError(error, { context: { action: "load hourly rates" } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente timepriser")
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRates()
  }, [loadRates])

  const filteredRates = rates.filter((rate) =>
    rate.job_type.toLowerCase().includes(search.toLowerCase())
  )

  const missingCostRates = rates.filter((rate) => rate.cost_rate_nok === null).length

  // Live dekningsgrad mens man skriver — gjør det tydelig hva kostprisen betyr.
  const costMarginPreview = (() => {
    const price = parseRateInput(rateInput)
    const cost = costInput.trim() ? parseRateInput(costInput) : null
    if (price == null || price <= 0 || cost == null) return null
    return Math.round(((price - cost) / price) * 100)
  })()

  const openCreateDialog = () => {
    setEditingRate(null)
    setJobType("")
    setRateInput("")
    setCostInput("")
    setDialogOpen(true)
  }

  const openEditDialog = (rate: HourlyRate) => {
    setEditingRate(rate)
    setJobType(rate.job_type)
    setRateInput(String(Math.round(rate.hourly_rate_nok)))
    setCostInput(rate.cost_rate_nok === null ? "" : String(Math.round(rate.cost_rate_nok)))
    setDialogOpen(true)
  }

  const openDeleteDialog = (rate: HourlyRate) => {
    setRateToDelete(rate)
    setDeleteDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setTimeout(() => {
      setEditingRate(null)
      setJobType("")
      setRateInput("")
      setCostInput("")
    }, 200)
  }

  const handleSave = async () => {
    const trimmedType = jobType.trim()
    const hourlyRateNok = parseRateInput(rateInput)

    if (!trimmedType) {
      toast.error("Jobbtype er påkrevd.")
      return
    }

    if (hourlyRateNok == null || hourlyRateNok < 0) {
      toast.error("Oppgi en gyldig timepris.")
      return
    }

    // Tomt felt = ingen kostpris satt. Det er en gyldig tilstand, ikke 0 kr.
    const trimmedCost = costInput.trim()
    const costRateNok = trimmedCost ? parseRateInput(trimmedCost) : null
    if (trimmedCost && (costRateNok == null || costRateNok < 0)) {
      toast.error("Oppgi en gyldig kostpris, eller la feltet stå tomt.")
      return
    }
    // Varsler, men stopper ikke: en time kan være priset med tap med vilje.
    if (costRateNok !== null && costRateNok > hourlyRateNok) {
      toast.warning("Kostprisen er høyere enn timeprisen — du taper penger på hver time.")
    }

    setIsSaving(true)

    try {
      const payload = { jobType: trimmedType, hourlyRateNok, costRateNok }
      const res = await fetch(
        editingRate ? `/api/mine-priser/timepriser/${editingRate.id}` : "/api/mine-priser/timepriser",
        {
          method: editingRate ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Kunne ikke lagre timepris")
      }

      const savedRate = data.rate as HourlyRate
      setRates((prev) => {
        if (editingRate) {
          return prev.map((rate) => (rate.id === savedRate.id ? savedRate : rate))
        }
        return [...prev, savedRate].sort((a, b) => a.job_type.localeCompare(b.job_type, "no"))
      })

      toast.success(editingRate ? "Timeprisen ble oppdatert." : "Timeprisen ble lagt til.")
      closeDialog()
    } catch (error) {
      console.error(error)
      reportClientError(error, { context: { action: "save hourly rate", rateId: editingRate?.id } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke lagre timepris")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!rateToDelete) return

    setIsSaving(true)
    try {
      const res = await fetch(`/api/mine-priser/timepriser/${rateToDelete.id}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Kunne ikke slette timepris")
      }

      setRates((prev) => prev.filter((rate) => rate.id !== rateToDelete.id))
      toast.success("Timeprisen ble slettet.")
      setDeleteDialogOpen(false)
      setRateToDelete(null)
    } catch (error) {
      console.error(error)
      reportClientError(error, { context: { action: "delete hourly rate", rateId: rateToDelete?.id } })
      toast.error(error instanceof Error ? error.message : "Kunne ikke slette timepris")
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mine priser</p>
          <h1 className="text-2xl font-semibold tracking-tight">Timepriser</h1>
          <p className="text-sm text-muted-foreground">
            Standard timepriser per type arbeid, f.eks. tømrerarbeid eller prosjektledelse.
            Timeprisen foreslås når du legger til arbeidstimer i tilbud, og kostprisen er det
            lønnskosten på prosjektenes lønnsomhet regnes ut fra.
          </p>
        </div>
        <Button onClick={openCreateDialog} className="w-full gap-2 sm:w-auto">
          <Plus className="h-4 w-4" />
          Ny timepris
        </Button>
      </div>

      {!isLoading && missingCostRates > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
          {missingCostRates === rates.length
            ? "Ingen av timeprisene har kostpris. Uten kostpris regnes lønnskosten på prosjektene som 0 kr, og dekningsgraden blir misvisende høy."
            : `${missingCostRates} av ${rates.length} timepriser mangler kostpris. Lønnskosten på prosjektene regnes ut fra snittet av dem som er satt.`}
        </p>
      )}

      <div className="relative w-full sm:w-72">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Søk i jobbtyper..."
          className="pl-9"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      <div className="hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/50 hover:bg-muted/50">
              <TableHead>Type arbeid</TableHead>
              <TableHead className="text-right">Timepris</TableHead>
              <TableHead className="text-right">Kostpris</TableHead>
              <TableHead className="text-right">Dekningsgrad</TableHead>
              <TableHead className="w-[70px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : filteredRates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  {rates.length === 0
                    ? "Ingen timepriser ennå. Legg til din første timepris."
                    : "Ingen jobbtyper matcher søket."}
                </TableCell>
              </TableRow>
            ) : (
              filteredRates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell className="font-medium">{rate.job_type}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRate(rate.hourly_rate_nok)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {rate.cost_rate_nok === null ? (
                      <button
                        type="button"
                        onClick={() => openEditDialog(rate)}
                        className="text-sm text-amber-700 underline underline-offset-2 hover:text-amber-800 dark:text-amber-400"
                      >
                        Ikke satt
                      </button>
                    ) : (
                      formatRate(rate.cost_rate_nok)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {marginPercent(rate) === null ? "—" : `${marginPercent(rate)} %`}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Åpne meny</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(rate)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Rediger
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => openDeleteDialog(rate)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Slett
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <div className="divide-y overflow-hidden rounded-lg border md:hidden">
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredRates.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted-foreground">
            {rates.length === 0
              ? "Ingen timepriser ennå. Legg til din første timepris."
              : "Ingen jobbtyper matcher søket."}
          </div>
        ) : (
          filteredRates.map((rate) => (
            <div key={rate.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium">{rate.job_type}</p>
                <p className="mt-1 text-sm tabular-nums text-muted-foreground">
                  {formatRate(rate.hourly_rate_nok)}
                  {rate.cost_rate_nok === null ? (
                    <span className="text-amber-700 dark:text-amber-400"> · kostpris ikke satt</span>
                  ) : (
                    <span>
                      {" · kost "}
                      {formatRate(rate.cost_rate_nok)}
                      {marginPercent(rate) === null ? "" : ` · DG ${marginPercent(rate)} %`}
                    </span>
                  )}
                </p>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEditDialog(rate)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Rediger
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => openDeleteDialog(rate)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Slett
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingRate ? "Rediger timepris" : "Ny timepris"}</DialogTitle>
            <DialogDescription>
              Velg type arbeid, sett timeprisen kunden skal betale, og hva timen koster deg.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="rate-job-type">Type arbeid</Label>
              <Input
                id="rate-job-type"
                list="rate-job-type-suggestions"
                placeholder="F.eks. Tømrerarbeid"
                value={jobType}
                onChange={(event) => setJobType(event.target.value)}
              />
              <datalist id="rate-job-type-suggestions">
                {RATE_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="rate-amount">Timepris (kr/t)</Label>
                <InfoHint title="Timepris (kr/t)">
                  <p>Det kunden betaler per time for denne typen arbeid.</p>
                  <p>Foreslås automatisk når du legger til arbeidstimer i et tilbud.</p>
                </InfoHint>
              </div>
              <Input
                id="rate-amount"
                inputMode="decimal"
                placeholder="650"
                value={rateInput}
                onChange={(event) => setRateInput(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="rate-cost">Kostpris (kr/t)</Label>
                <InfoHint title="Kostpris (kr/t)">
                  <p>
                    Hva timen koster deg — lønn, feriepenger, arbeidsgiveravgift og sosiale
                    kostnader.
                  </p>
                  <p>
                    Dette er tallet lønnskosten på prosjektenes lønnsomhet regnes ut fra. Uten
                    kostpris blir lønnskosten 0 kr, og dekningsgraden ser bedre ut enn den er.
                  </p>
                  <p>La feltet stå tomt hvis du ikke vet — det er ærligere enn å gjette.</p>
                </InfoHint>
              </div>
              <Input
                id="rate-cost"
                inputMode="decimal"
                placeholder="F.eks. 420"
                value={costInput}
                onChange={(event) => setCostInput(event.target.value)}
              />
              {costMarginPreview !== null && (
                <p className="text-xs text-muted-foreground">
                  Dekningsgrad på timen: <span className="font-medium text-foreground">{costMarginPreview} %</span>
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={isSaving}>
              Avbryt
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : editingRate ? "Lagre endringer" : "Legg til timepris"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setRateToDelete(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Slett timepris?</DialogTitle>
            <DialogDescription>
              {rateToDelete
                ? `"${rateToDelete.job_type}" (${formatRate(rateToDelete.hourly_rate_nok)}) fjernes permanent.`
                : "Denne handlingen kan ikke angres."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={isSaving}>
              Avbryt
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Slett timepris"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
