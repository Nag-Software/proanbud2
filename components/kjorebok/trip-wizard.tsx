"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { ArrowUpDownIcon, FuelIcon, Loader2Icon } from "lucide-react"

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
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { reportClientError } from "@/lib/errors/client"
import { createTripAction } from "@/app/kjorebok/actions"
import { computeTripAmount } from "@/lib/kjorebok/rates"
import { computeFuelCost } from "@/lib/kjorebok/fuel"
import { GeocodeAutocomplete } from "./geocode-autocomplete"
import type {
  GeocodeResult,
  LiveTripDraft,
  LngLat,
  TripWithRefs,
  VehicleRow,
} from "@/lib/kjorebok/types"

const TripMap = dynamic(() => import("./trip-map").then((m) => m.TripMap), { ssr: false })

const NONE = "__none__"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: { id: string; name: string }[]
  drivers: { id: string; name: string | null }[]
  vehicles: VehicleRow[]
  canViewAll: boolean
  currentUserId: string
  defaultProjectId?: string | null
  gpsDraft?: LiveTripDraft | null
  onSaved: (trip: TripWithRefs) => void
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function kr(n: number) {
  return n.toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 })
}

/**
 * Map-first "Ny tur" creator: a near-fullscreen map with Google-Maps-style
 * from/to address inputs floating on top, the route drawn live, and the key
 * stats (distance, godtgjørelse, drivstoffutgifter) shown as overlay chips.
 * The handful of fields needed to file the trip sit in a compact panel below.
 *
 * Used for brand-new trips and for finishing a GPS-tracked trip (gpsDraft).
 * Editing an existing trip uses the detailed TripFormDialog.
 */
export function TripWizard({
  open,
  onOpenChange,
  projects,
  drivers,
  vehicles,
  canViewAll,
  currentUserId,
  defaultProjectId,
  gpsDraft,
  onSaved,
}: Props) {
  const [fromAddress, setFromAddress] = useState("")
  const [fromLat, setFromLat] = useState<number | null>(null)
  const [fromLng, setFromLng] = useState<number | null>(null)
  const [toAddress, setToAddress] = useState("")
  const [toLat, setToLat] = useState<number | null>(null)
  const [toLng, setToLng] = useState<number | null>(null)
  const [distanceKm, setDistanceKm] = useState("")
  const [routeGeometry, setRouteGeometry] = useState<LngLat[] | null>(null)

  const [vehicleId, setVehicleId] = useState<string>(NONE)
  const [classification, setClassification] = useState<"business" | "private">("business")
  const [tripDate, setTripDate] = useState<string>(todayIso())
  const [projectId, setProjectId] = useState<string>(NONE)
  const [driverUserId, setDriverUserId] = useState<string>(currentUserId)
  const [purpose, setPurpose] = useState("")
  const [startTime, setStartTime] = useState<string | null>(null)
  const [endTime, setEndTime] = useState<string | null>(null)
  const [source, setSource] = useState<"manual" | "gps">("manual")

  const [routing, setRouting] = useState(false)
  const [routeNote, setRouteNote] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // (Re)initialise whenever the wizard opens, optionally seeded from a GPS draft.
  useEffect(() => {
    if (!open) return
    setFromAddress(gpsDraft?.fromAddress ?? "")
    setFromLat(gpsDraft?.fromLat ?? null)
    setFromLng(gpsDraft?.fromLng ?? null)
    setToAddress(gpsDraft?.toAddress ?? "")
    setToLat(gpsDraft?.toLat ?? null)
    setToLng(gpsDraft?.toLng ?? null)
    setDistanceKm(gpsDraft ? String(gpsDraft.distanceKm) : "")
    setRouteGeometry(gpsDraft?.routeGeometry ?? null)
    setVehicleId(NONE)
    setClassification("business")
    setTripDate(gpsDraft ? gpsDraft.startTime.slice(0, 10) : todayIso())
    setProjectId(defaultProjectId ?? NONE)
    setDriverUserId(currentUserId)
    setPurpose("")
    setStartTime(gpsDraft?.startTime ?? null)
    setEndTime(gpsDraft?.endTime ?? null)
    setSource(gpsDraft ? "gps" : "manual")
    setError(null)
    setRouteNote(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, gpsDraft])

  const kmNum = useMemo(() => {
    const n = Number(distanceKm.replace(",", "."))
    return Number.isFinite(n) ? n : 0
  }, [distanceKm])

  const amount = useMemo(
    () =>
      computeTripAmount({
        distanceKm: kmNum,
        passengers: 0,
        anleggsvei: false,
        year: Number(tripDate.slice(0, 4)) || undefined,
      }),
    [kmNum, tripDate]
  )

  const selectedVehicle = vehicleId !== NONE ? vehicles.find((v) => v.id === vehicleId) ?? null : null
  const fuel = useMemo(
    () =>
      computeFuelCost({
        distanceKm: kmNum,
        consumptionLPerMil: selectedVehicle?.fuel_consumption_l_per_mil,
        fuelType: selectedVehicle?.fuel_type,
      }),
    [kmNum, selectedVehicle?.fuel_consumption_l_per_mil, selectedVehicle?.fuel_type]
  )

  async function recalcRoute(flat: number, flng: number, tlat: number, tlng: number) {
    setRouting(true)
    setRouteNote(null)
    try {
      const res = await fetch("/api/kjorebok/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: { lat: flat, lng: flng }, to: { lat: tlat, lng: tlng } }),
      })
      const data = await res.json()
      if (typeof data?.distanceKm === "number") {
        setDistanceKm(String(data.distanceKm))
        setRouteGeometry(Array.isArray(data.geometry) ? data.geometry : null)
        if (data.source === "haversine") setRouteNote("Anslått luftlinje – juster ved behov.")
      }
    } catch (e) {
      reportClientError(e, { context: { action: "beregne kjørerute" } })
    } finally {
      setRouting(false)
    }
  }

  function onPickFrom(r: GeocodeResult) {
    setFromAddress(r.label)
    setFromLat(r.lat)
    setFromLng(r.lng)
    if (toLat != null && toLng != null) void recalcRoute(r.lat, r.lng, toLat, toLng)
  }
  function onPickTo(r: GeocodeResult) {
    setToAddress(r.label)
    setToLat(r.lat)
    setToLng(r.lng)
    if (fromLat != null && fromLng != null) void recalcRoute(fromLat, fromLng, r.lat, r.lng)
  }

  function swapEndpoints() {
    setFromAddress(toAddress)
    setFromLat(toLat)
    setFromLng(toLng)
    setToAddress(fromAddress)
    setToLat(fromLat)
    setToLng(fromLng)
    if (fromLat != null && fromLng != null && toLat != null && toLng != null) {
      void recalcRoute(toLat, toLng, fromLat, fromLng)
    }
  }

  function onSelectVehicle(id: string) {
    setVehicleId(id)
    // Convenience for managers: jump to the car's default driver when set.
    if (canViewAll && id !== NONE) {
      const v = vehicles.find((x) => x.id === id)
      if (v?.default_driver) setDriverUserId(v.default_driver)
    }
  }

  async function handleSubmit() {
    setError(null)
    if (!Number.isFinite(kmNum) || kmNum <= 0) {
      setError("Legg inn en strekning eller distanse")
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) {
      setError("Velg en gyldig dato")
      return
    }
    setSubmitting(true)
    try {
      const saved = await createTripAction({
        projectId: projectId === NONE ? null : projectId,
        driverUserId,
        vehicleId: vehicleId === NONE ? null : vehicleId,
        tripDate,
        startTime,
        endTime,
        fromAddress: fromAddress || null,
        fromLat,
        fromLng,
        toAddress: toAddress || null,
        toLat,
        toLng,
        distanceKm: kmNum,
        purpose: purpose || null,
        classification,
        passengers: 0,
        anleggsvei: false,
        routeGeometry,
        source,
      })
      onSaved(saved)
      onOpenChange(false)
    } catch (e) {
      reportClientError(e, { context: { action: "lagre kjøretur" } })
      setError(e instanceof Error ? e.message : "Kunne ikke lagre kjøretur")
    } finally {
      setSubmitting(false)
    }
  }

  const mapFrom = fromLat != null && fromLng != null ? { lat: fromLat, lng: fromLng } : null
  const mapTo = toLat != null && toLng != null ? { lat: toLat, lng: toLng } : null
  const hasBothPoints = mapFrom != null && mapTo != null

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <ResponsiveDialogHeader className="sr-only">
          <ResponsiveDialogTitle>Ny kjøretur</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Skriv inn fra- og til-adresse for å beregne strekning, godtgjørelse og drivstoffutgifter.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex max-h-[90vh] flex-col sm:max-h-[86vh]">
          {/* MAP ZONE — fills the top, with floating address card + stat chips. */}
          <div className="relative h-[40vh] shrink-0 sm:h-[48vh]">
            <TripMap
              routeGeometry={routeGeometry}
              from={mapFrom}
              to={mapTo}
              interactive
              className="absolute inset-0 h-full w-full"
            />

            {/* Address card (Google-Maps style) */}
            <div className="absolute inset-x-3 top-3 z-10 rounded-2xl border bg-background/95 p-1.5 shadow-lg backdrop-blur supports-backdrop-filter:bg-background/80">
              <div className="flex items-center gap-1.5">
                <div className="flex flex-1 flex-col">
                  <div className="flex items-center gap-2 pl-2 pr-1">
                    <span className="size-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20" />
                    <GeocodeAutocomplete
                      value={fromAddress}
                      onChange={(v) => {
                        setFromAddress(v)
                        setFromLat(null)
                        setFromLng(null)
                      }}
                      onSelect={onPickFrom}
                      placeholder="Fra hvor?"
                      inputClassName="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
                    />
                  </div>
                  <div className="ml-[14px] h-3 w-px border-l border-dashed border-muted-foreground/40" />
                  <div className="flex items-center gap-2 pl-2 pr-1">
                    <span className="size-2.5 shrink-0 rounded-full bg-rose-500 ring-2 ring-rose-500/20" />
                    <GeocodeAutocomplete
                      value={toAddress}
                      onChange={(v) => {
                        setToAddress(v)
                        setToLat(null)
                        setToLng(null)
                      }}
                      onSelect={onPickTo}
                      placeholder="Til hvor?"
                      inputClassName="h-9 border-0 bg-transparent px-0 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-muted-foreground"
                  onClick={swapEndpoints}
                  title="Bytt fra/til"
                >
                  <ArrowUpDownIcon className="size-4" />
                </Button>
              </div>
            </div>

            {/* Stat chips — kept clear of the bottom-right map attribution. */}
            <div className="absolute inset-x-3 bottom-8 z-10 grid grid-cols-3 gap-1.5">
              <StatChip
                label="Distanse"
                value={
                  routing ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : kmNum > 0 ? (
                    `${kmNum.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} km`
                  ) : (
                    "—"
                  )
                }
              />
              <StatChip
                label={classification === "private" ? "Beløp (privat)" : "Godtgjørelse"}
                value={kmNum > 0 ? kr(amount.amountNok) : "—"}
              />
              <StatChip
                label="Drivstoff"
                value={fuel.costNok > 0 ? kr(fuel.costNok) : "—"}
                hint={
                  vehicleId === NONE
                    ? "Velg kjøretøy"
                    : fuel.costNok === 0
                      ? "Mangler forbruk"
                      : undefined
                }
              />
            </div>
          </div>

          {/* DETAILS — compact panel, scrolls if needed; action bar pinned below. */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto border-t p-4">
            {routeNote && <p className="text-xs text-amber-600">{routeNote}</p>}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Kjøretøy</Label>
                <Select value={vehicleId} onValueChange={onSelectVehicle}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Uten kjøretøy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Uten kjøretøy</SelectItem>
                    {vehicles.map((v) => (
                      <SelectItem key={v.id} value={v.id}>
                        {v.name}
                        {v.registration ? ` (${v.registration})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Klassifisering</Label>
                <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
                  <button
                    type="button"
                    onClick={() => setClassification("business")}
                    className={cn(
                      "rounded-md px-2 py-1.5 text-sm font-medium transition",
                      classification === "business"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    Yrke
                  </button>
                  <button
                    type="button"
                    onClick={() => setClassification("private")}
                    className={cn(
                      "rounded-md px-2 py-1.5 text-sm font-medium transition",
                      classification === "private"
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted"
                    )}
                  >
                    Privat
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wiz-date">Dato</Label>
                <Input
                  id="wiz-date"
                  type="date"
                  value={tripDate}
                  max={todayIso()}
                  onChange={(e) => setTripDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="wiz-distance">Distanse (km)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="wiz-distance"
                    inputMode="decimal"
                    value={distanceKm}
                    onChange={(e) => setDistanceKm(e.target.value)}
                    placeholder="0"
                  />
                  {hasBothPoints && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void recalcRoute(fromLat!, fromLng!, toLat!, toLng!)}
                      disabled={routing}
                    >
                      {routing ? <Loader2Icon className="size-4 animate-spin" /> : "Beregn"}
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Prosjekt</Label>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Uten prosjekt" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Uten prosjekt</SelectItem>
                    {projects.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {canViewAll && (
                <div className="space-y-1.5">
                  <Label>Sjåfør</Label>
                  <Select value={driverUserId} onValueChange={setDriverUserId}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {drivers.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.name ?? "Ukjent"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="wiz-purpose">Formål</Label>
                <Input
                  id="wiz-purpose"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="F.eks. befaring, levering, kundemøte"
                />
              </div>
            </div>

            {selectedVehicle && fuel.costNok > 0 && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <FuelIcon className="size-3.5" />
                {fuel.liters.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} liter ·{" "}
                {fuel.pricePerLiter} kr/l ({selectedVehicle.fuel_consumption_l_per_mil} l/mil)
              </p>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          {/* Action bar */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-muted/40 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Avbryt
            </Button>
            <Button onClick={handleSubmit} disabled={submitting}>
              {submitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Lagre tur
            </Button>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

function StatChip({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div className="rounded-xl border bg-background/95 px-3 py-2 text-center shadow-sm backdrop-blur supports-backdrop-filter:bg-background/80">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="flex items-center justify-center text-sm font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-[10px] leading-tight text-muted-foreground">{hint}</p>}
    </div>
  )
}
