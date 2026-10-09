"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2, Users } from "lucide-react"
import { toast } from "sonner"

import {
  getEmployeeRateAssignments,
  setEmployeeHourlyRate,
  type EmployeeRateAssignmentRow,
  type EmployeeRateAssignments,
} from "@/app/mine-priser/timepriser/actions"
import { reportClientError, actionErrorMessage } from "@/lib/errors/client"
import {
  fetchHourlyRates,
  MINE_PRISER_KEYS,
  MINE_PRISER_MOUNT_MAX_AGE_MS,
} from "@/lib/mine-priser/client-api"
import { fetchPrefetched, readPrefetched, replacePrefetched } from "@/lib/perf/prefetch-cache"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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

/** «Ola, Kari +2» — navnene på de ansatte som jobber til satsen, kort nok for en tabellcelle. */
function EmployeeChips({ employees }: { employees: EmployeeRateAssignmentRow[] }) {
  if (employees.length === 0) return <span className="text-sm text-muted-foreground">Ingen</span>
  const shown = employees.slice(0, 3)
  const rest = employees.length - shown.length
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((employee) => (
        <Badge key={employee.id} variant="secondary" className="max-w-[10rem] truncate font-normal">
          {employee.name}
        </Badge>
      ))}
      {rest > 0 ? <span className="text-xs text-muted-foreground">+{rest}</span> : null}
    </span>
  )
}

export function TimepriserPage({ canAssign = false }: { canAssign?: boolean }) {
  // Hentet allerede da lenken ble pekt på (lib/perf/page-data-warmers) — vis det som ligger
  // i cachen med en gang, og frisk opp i bakgrunnen.
  const [rates, setRates] = useState<HourlyRate[]>(() => readPrefetched<HourlyRate[]>(MINE_PRISER_KEYS.timepriser) ?? [])
  const [search, setSearch] = useState("")
  const [isLoading, setIsLoading] = useState(() => readPrefetched(MINE_PRISER_KEYS.timepriser) === undefined)
  const [isSaving, setIsSaving] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [editingRate, setEditingRate] = useState<HourlyRate | null>(null)
  const [rateToDelete, setRateToDelete] = useState<HourlyRate | null>(null)
  const [jobType, setJobType] = useState("")
  const [rateInput, setRateInput] = useState("")
  const [costInput, setCostInput] = useState("")

  // Hvem som jobber til hvilken sats (db/115). `null` til det er hentet;
  // `available: false` når migrasjonen ikke er kjørt — da vises ingen koblinger.
  const [assignments, setAssignments] = useState<EmployeeRateAssignments | null>(null)
  const [assignDialogRate, setAssignDialogRate] = useState<HourlyRate | null>(null)
  const [assignSelection, setAssignSelection] = useState<Set<string>>(new Set())
  const [isAssigning, setIsAssigning] = useState(false)

  const loadAssignments = useCallback(async () => {
    try {
      setAssignments(await getEmployeeRateAssignments())
    } catch (error) {
      reportClientError(error, { level: "warning", context: { action: "load employee hourly rate assignments" } })
      setAssignments({ available: false, employees: [] })
    }
  }, [])

  useEffect(() => {
    void loadAssignments()
  }, [loadAssignments])

  const employeesByRate = useMemo(() => {
    const map = new Map<string, EmployeeRateAssignmentRow[]>()
    for (const employee of assignments?.employees ?? []) {
      if (!employee.hourlyRateId) continue
      const list = map.get(employee.hourlyRateId) ?? []
      list.push(employee)
      map.set(employee.hourlyRateId, list)
    }
    return map
  }, [assignments])

  // Aktive ansatte som regnes med snittet: uten kobling, eller koblet til en sats
  // uten kostpris. Det er dem lønnsomheten blir grovere for.
  const employeesOnAverage = useMemo(() => {
    if (!assignments?.available) return []
    const rateById = new Map(rates.map((rate) => [rate.id, rate]))
    return assignments.employees.filter((employee) => {
      if (!employee.isActive) return false
      const rate = employee.hourlyRateId ? rateById.get(employee.hourlyRateId) : undefined
      return !rate || rate.cost_rate_nok === null
    })
  }, [assignments, rates])

  const loadRates = useCallback(async () => {
    // Spinner bare når det ikke finnes noe å vise ennå.
    if (readPrefetched(MINE_PRISER_KEYS.timepriser) === undefined) setIsLoading(true)
    try {
      setRates(
        await fetchPrefetched(MINE_PRISER_KEYS.timepriser, fetchHourlyRates<HourlyRate>, {
          maxAgeMs: MINE_PRISER_MOUNT_MAX_AGE_MS,
        })
      )
    } catch (error) {
      console.error(error)
      reportClientError(error, { context: { action: "load hourly rates" } })
      toast.error(actionErrorMessage(error, "Kunne ikke hente timepriser"))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadRates()
  }, [loadRates])

  // Lokale endringer (lagret/slettet) speiles inn i cachen, så en rask
  // tilbake-navigasjon ikke viser lista fra før endringen.
  useEffect(() => {
    replacePrefetched(MINE_PRISER_KEYS.timepriser, rates)
  }, [rates])

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

  const openAssignDialog = (rate: HourlyRate) => {
    setAssignDialogRate(rate)
    setAssignSelection(new Set((employeesByRate.get(rate.id) ?? []).map((employee) => employee.id)))
  }

  const closeAssignDialog = () => {
    setAssignDialogRate(null)
    setAssignSelection(new Set())
  }

  const handleAssignSave = async () => {
    if (!assignDialogRate || !assignments) return
    const rateId = assignDialogRate.id
    const before = new Set((employeesByRate.get(rateId) ?? []).map((employee) => employee.id))
    const toAssign = [...assignSelection].filter((id) => !before.has(id))
    const toRemove = [...before].filter((id) => !assignSelection.has(id))
    if (toAssign.length === 0 && toRemove.length === 0) {
      closeAssignDialog()
      return
    }

    setIsAssigning(true)
    try {
      const results = await Promise.all([
        ...toAssign.map((userId) => setEmployeeHourlyRate({ userId, hourlyRateId: rateId })),
        ...toRemove.map((userId) => setEmployeeHourlyRate({ userId, hourlyRateId: null })),
      ])
      const failed = results.find((result) => "error" in result)
      if (failed && "error" in failed) {
        toast.error(failed.error)
      } else {
        toast.success(
          toAssign.length + toRemove.length === 1
            ? `Koblingen til «${assignDialogRate.job_type}» er oppdatert.`
            : `${toAssign.length + toRemove.length} koblinger til «${assignDialogRate.job_type}» er oppdatert.`
        )
      }
      // Speil resultatet lokalt så tabellen ikke venter på en ny henting.
      setAssignments((prev) =>
        prev
          ? {
              ...prev,
              employees: prev.employees.map((employee) =>
                toAssign.includes(employee.id)
                  ? { ...employee, hourlyRateId: rateId }
                  : toRemove.includes(employee.id)
                    ? { ...employee, hourlyRateId: null }
                    : employee
              ),
            }
          : prev
      )
      closeAssignDialog()
      void loadAssignments()
    } catch (error) {
      reportClientError(error, { context: { action: "assign employees to hourly rate", rateId } })
      toast.error(actionErrorMessage(error, "Kunne ikke lagre koblingen"))
    } finally {
      setIsAssigning(false)
    }
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
      toast.error(actionErrorMessage(error, "Kunne ikke lagre timepris"))
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
      toast.error(actionErrorMessage(error, "Kunne ikke slette timepris"))
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
          <p className="max-w-prose text-sm text-muted-foreground">
            Hva kunden betaler per time, og hva timen koster deg. Brukes i tilbud, og per ansatt
            for riktig lønnskost på prosjektene.
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

      {!isLoading && rates.length > 0 && employeesOnAverage.length > 0 && (
        <p className="rounded-md border px-3 py-2 text-sm text-muted-foreground">
          {employeesOnAverage.length === 1
            ? `${employeesOnAverage[0].name} er ikke koblet til en timepris med kostpris, og regnes med snittet av kostprisene på prosjektene.`
            : `${employeesOnAverage.length} ansatte er ikke koblet til en timepris med kostpris, og regnes med snittet av kostprisene på prosjektene.`}{" "}
          {canAssign ? (
            <>Bruk «Koble ansatte» på en timepris, eller sett timepris under{" "}
              <Link href="/min-bedrift/ansatte-og-roller" className="font-medium text-foreground underline underline-offset-2">
                Ansatte og roller
              </Link>
              .
            </>
          ) : (
            "Bare administratorer kan koble ansatte til timepriser."
          )}
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
              {assignments?.available ? <TableHead>Ansatte</TableHead> : null}
              <TableHead className="w-[70px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            ) : filteredRates.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
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
                  {assignments?.available ? (
                    <TableCell>
                      {canAssign ? (
                        <button
                          type="button"
                          onClick={() => openAssignDialog(rate)}
                          className="rounded-sm text-left hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Koble ansatte til ${rate.job_type}`}
                        >
                          <EmployeeChips employees={employeesByRate.get(rate.id) ?? []} />
                        </button>
                      ) : (
                        <EmployeeChips employees={employeesByRate.get(rate.id) ?? []} />
                      )}
                    </TableCell>
                  ) : null}
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
                        {canAssign && assignments?.available ? (
                          <DropdownMenuItem onClick={() => openAssignDialog(rate)}>
                            <Users className="mr-2 h-4 w-4" />
                            Koble ansatte
                          </DropdownMenuItem>
                        ) : null}
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
                {assignments?.available ? (
                  <div className="mt-2">
                    <EmployeeChips employees={employeesByRate.get(rate.id) ?? []} />
                  </div>
                ) : null}
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
                  {canAssign && assignments?.available ? (
                    <DropdownMenuItem onClick={() => openAssignDialog(rate)}>
                      <Users className="mr-2 h-4 w-4" />
                      Koble ansatte
                    </DropdownMenuItem>
                  ) : null}
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
                  <p>
                    Endrer du kostprisen, gjelder den nye også timer som allerede er ført på denne
                    satsen — også på avsluttede prosjekter.
                  </p>
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

      <Dialog open={assignDialogRate !== null} onOpenChange={(open) => (open ? null : closeAssignDialog())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Koble ansatte til «{assignDialogRate?.job_type}»</DialogTitle>
            <DialogDescription>
              Timene disse ansatte fører regnes med{" "}
              {assignDialogRate?.cost_rate_nok !== null && assignDialogRate !== null
                ? `kostprisen ${formatRate(assignDialogRate.cost_rate_nok)}`
                : "kostprisen på denne timeprisen (ikke satt ennå)"}{" "}
              i prosjektøkonomien. En ansatt kan bare være koblet til én timepris.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(420px,50vh)] space-y-1 overflow-y-auto py-1">
            {(assignments?.employees ?? []).filter((employee) => employee.isActive).length === 0 ? (
              <p className="px-1 py-6 text-center text-sm text-muted-foreground">
                Ingen aktive ansatte. Inviter ansatte under Min bedrift → Ansatte og roller.
              </p>
            ) : (
              (assignments?.employees ?? [])
                .filter((employee) => employee.isActive)
                .map((employee) => {
                  const checked = assignSelection.has(employee.id)
                  const otherRate =
                    employee.hourlyRateId && employee.hourlyRateId !== assignDialogRate?.id
                      ? rates.find((rate) => rate.id === employee.hourlyRateId)
                      : undefined
                  return (
                    <label
                      key={employee.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(value) =>
                          setAssignSelection((prev) => {
                            const next = new Set(prev)
                            if (value === true) next.add(employee.id)
                            else next.delete(employee.id)
                            return next
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{employee.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {otherRate
                            ? checked
                              ? `Flyttes fra «${otherRate.job_type}»`
                              : `Koblet til «${otherRate.job_type}»`
                            : employee.hourlyRateId
                              ? checked
                                ? "Koblet til denne"
                                : "Kobles fra – regnes med snittet"
                              : "Ikke koblet – regnes med snittet"}
                        </span>
                      </span>
                    </label>
                  )
                })
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeAssignDialog} disabled={isAssigning}>
              Avbryt
            </Button>
            <Button onClick={handleAssignSave} disabled={isAssigning || !assignments}>
              {isAssigning ? <Loader2 className="h-4 w-4 animate-spin" /> : "Lagre kobling"}
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
              {rateToDelete && (employeesByRate.get(rateToDelete.id)?.length ?? 0) > 0
                ? ` ${employeesByRate.get(rateToDelete.id)!.length === 1 ? "1 ansatt er" : `${employeesByRate.get(rateToDelete.id)!.length} ansatte er`} koblet til denne timeprisen. Sletter du den, regnes de med snittet av kostprisene til de kobles på nytt.`
                : null}
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
