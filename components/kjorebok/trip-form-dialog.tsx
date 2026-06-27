"use client"

import { useEffect, useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Loader2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
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
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { reportClientError } from "@/lib/errors/client"
import { createTripAction, updateTripAction } from "@/app/kjorebok/actions"
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
  editingTrip?: TripWithRefs | null
  gpsDraft?: LiveTripDraft | null
  onSaved: (trip: TripWithRefs) => void
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export function TripFormDialog({
  open,
  onOpenChange,
  projects,
  drivers,
  vehicles,
  canViewAll,
  currentUserId,
  defaultProjectId,
  editingTrip,
  gpsDraft,
  onSaved,
}: Props) {
  const [projectId, setProjectId] = useState<string>(NONE)
  const [driverUserId, setDriverUserId] = useState<string>(currentUserId)
  const [vehicleId, setVehicleId] = useState<string>(NONE)
  const [tripDate, setTripDate] = useState<string>(todayIso())
  const [startTime, setStartTime] = useState<string | null>(null)
  const [endTime, setEndTime] = useState<string | null>(null)
  const [fromAddress, setFromAddress] = useState("")
  const [fromLat, setFromLat] = useState<number | null>(null)
  const [fromLng, setFromLng] = useState<number | null>(null)
  const [toAddress, setToAddress] = useState("")
  const [toLat, setToLat] = useState<number | null>(null)
  const [toLng, setToLng] = useState<number | null>(null)
  const [distanceKm, setDistanceKm] = useState("")
  const [routeGeometry, setRouteGeometry] = useState<LngLat[] | null>(null)
  const [purpose, setPurpose] = useState("")
  const [classification, setClassification] = useState<"business" | "private">("business")
  const [passengers, setPassengers] = useState("0")
  const [anleggsvei, setAnleggsvei] = useState(false)
  const [odometerStart, setOdometerStart] = useState("")
  const [odometerEnd, setOdometerEnd] = useState("")
  const [notes, setNotes] = useState("")
  const [source, setSource] = useState<"manual" | "gps">("manual")

  const [routing, setRouting] = useState(false)
  const [routeNote, setRouteNote] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // (Re)initialise whenever the dialog opens or its subject changes.
  useEffect(() => {
    if (!open) return
    if (editingTrip) {
      setProjectId(editingTrip.project_id ?? NONE)
      setDriverUserId(editingTrip.driver_user_id)
      setVehicleId(editingTrip.vehicle_id ?? NONE)
      setTripDate(editingTrip.trip_date)
      setStartTime(editingTrip.start_time)
      setEndTime(editingTrip.end_time)
      setFromAddress(editingTrip.from_address ?? "")
      setFromLat(editingTrip.from_lat)
      setFromLng(editingTrip.from_lng)
      setToAddress(editingTrip.to_address ?? "")
      setToLat(editingTrip.to_lat)
      setToLng(editingTrip.to_lng)
      setDistanceKm(String(editingTrip.distance_km ?? ""))
      setRouteGeometry(editingTrip.route_geometry ?? null)
      setPurpose(editingTrip.purpose ?? "")
      setClassification(editingTrip.classification)
      setPassengers(String(editingTrip.passengers ?? 0))
      setAnleggsvei(editingTrip.anleggsvei)
      setOdometerStart(editingTrip.odometer_start != null ? String(editingTrip.odometer_start) : "")
      setOdometerEnd(editingTrip.odometer_end != null ? String(editingTrip.odometer_end) : "")
      setNotes(editingTrip.notes ?? "")
      setSource(editingTrip.source)
    } else {
      // New trip — optionally seeded from a GPS draft.
      setProjectId(defaultProjectId ?? NONE)
      setDriverUserId(currentUserId)
      setVehicleId(NONE)
      setTripDate(gpsDraft ? gpsDraft.startTime.slice(0, 10) : todayIso())
      setStartTime(gpsDraft?.startTime ?? null)
      setEndTime(gpsDraft?.endTime ?? null)
      setFromAddress(gpsDraft?.fromAddress ?? "")
      setFromLat(gpsDraft?.fromLat ?? null)
      setFromLng(gpsDraft?.fromLng ?? null)
      setToAddress(gpsDraft?.toAddress ?? "")
      setToLat(gpsDraft?.toLat ?? null)
      setToLng(gpsDraft?.toLng ?? null)
      setDistanceKm(gpsDraft ? String(gpsDraft.distanceKm) : "")
      setRouteGeometry(gpsDraft?.routeGeometry ?? null)
      setPurpose("")
      setClassification("business")
      setPassengers("0")
      setAnleggsvei(false)
      setOdometerStart("")
      setOdometerEnd("")
      setNotes("")
      setSource(gpsDraft ? "gps" : "manual")
    }
    setError(null)
    setRouteNote(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingTrip?.id, gpsDraft])

  const amount = useMemo(() => {
    const km = Number(distanceKm.replace(",", "."))
    return computeTripAmount({
      distanceKm: Number.isFinite(km) ? km : 0,
      passengers: Number(passengers) || 0,
      anleggsvei,
      year: Number(tripDate.slice(0, 4)) || undefined,
    })
  }, [distanceKm, passengers, anleggsvei, tripDate])

  const selectedVehicle = vehicleId !== NONE ? vehicles.find((v) => v.id === vehicleId) ?? null : null
  const fuel = useMemo(() => {
    const km = Number(distanceKm.replace(",", "."))
    return computeFuelCost({
      distanceKm: Number.isFinite(km) ? km : 0,
      consumptionLPerMil: selectedVehicle?.fuel_consumption_l_per_mil,
      fuelType: selectedVehicle?.fuel_type,
    })
  }, [distanceKm, selectedVehicle?.fuel_consumption_l_per_mil, selectedVehicle?.fuel_type])

  async function recalcRoute() {
    if (fromLat == null || fromLng == null || toLat == null || toLng == null) return
    setRouting(true)
    setRouteNote(null)
    try {
      const res = await fetch("/api/kjorebok/route", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: { lat: fromLat, lng: fromLng }, to: { lat: toLat, lng: toLng } }),
      })
      const data = await res.json()
      if (typeof data?.distanceKm === "number") {
        setDistanceKm(String(data.distanceKm))
        setRouteGeometry(Array.isArray(data.geometry) ? data.geometry : null)
        setSource((s) => (s === "gps" ? s : "manual"))
        if (data.source === "haversine") setRouteNote("Anslått luftlinje – juster ved behov.")
      }
    } catch (e) {
      reportClientError(e, { context: { action: "beregne kjørerute" } })
    } finally {
      setRouting(false)
    }
  }

  // Auto-route when both endpoints are geocoded (skips while editing an existing
  // trip that already has its own distance, unless the user re-picks an address).
  function onPickFrom(r: GeocodeResult) {
    setFromAddress(r.label)
    setFromLat(r.lat)
    setFromLng(r.lng)
    if (toLat != null && toLng != null) void recalcRouteWith(r.lat, r.lng, toLat, toLng)
  }
  function onPickTo(r: GeocodeResult) {
    setToAddress(r.label)
    setToLat(r.lat)
    setToLng(r.lng)
    if (fromLat != null && fromLng != null) void recalcRouteWith(fromLat, fromLng, r.lat, r.lng)
  }
  async function recalcRouteWith(flat: number, flng: number, tlat: number, tlng: number) {
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
    } catch {
      /* non-fatal */
    } finally {
      setRouting(false)
    }
  }

  async function handleSubmit() {
    setError(null)
    const km = Number(distanceKm.replace(",", "."))
    if (!Number.isFinite(km) || km < 0) {
      setError("Distanse må være et positivt tall")
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) {
      setError("Velg en gyldig dato")
      return
    }
    setSubmitting(true)
    try {
      const input = {
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
        distanceKm: km,
        purpose: purpose || null,
        classification,
        passengers: Number(passengers) || 0,
        anleggsvei,
        odometerStart: odometerStart ? Number(odometerStart) : null,
        odometerEnd: odometerEnd ? Number(odometerEnd) : null,
        routeGeometry,
        notes: notes || null,
        source,
      }
      const saved = editingTrip
        ? await updateTripAction(editingTrip.id, input)
        : await createTripAction(input)
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

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <ResponsiveDialogHeader className="px-4 sm:px-0">
          <ResponsiveDialogTitle>{editingTrip ? "Rediger kjøretur" : "Ny kjøretur"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            Statens satser beregnes automatisk. Du kan justere alle felt.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="space-y-4 px-4 pb-2 sm:px-0">
          {(mapFrom || routeGeometry) && (
            <div className="overflow-hidden rounded-xl border">
              <TripMap
                routeGeometry={routeGeometry}
                from={mapFrom}
                to={mapTo}
                interactive={false}
                className="h-[200px] w-full"
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Fra</Label>
              <GeocodeAutocomplete
                value={fromAddress}
                onChange={(v) => {
                  setFromAddress(v)
                  setFromLat(null)
                  setFromLng(null)
                }}
                onSelect={onPickFrom}
                placeholder="Startadresse"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Til</Label>
              <GeocodeAutocomplete
                value={toAddress}
                onChange={(v) => {
                  setToAddress(v)
                  setToLat(null)
                  setToLng(null)
                }}
                onSelect={onPickTo}
                placeholder="Sluttadresse"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="trip-date">Dato</Label>
              <Input id="trip-date" type="date" value={tripDate} max={todayIso()} onChange={(e) => setTripDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trip-distance">Distanse (km)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="trip-distance"
                  inputMode="decimal"
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(e.target.value)}
                  placeholder="0"
                />
                {(mapFrom && mapTo) && (
                  <Button type="button" variant="outline" size="sm" onClick={recalcRoute} disabled={routing}>
                    {routing ? <Loader2Icon className="size-4 animate-spin" /> : "Beregn"}
                  </Button>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Klassifisering</Label>
              <Select value={classification} onValueChange={(v) => setClassification(v as "business" | "private")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="business">Yrkeskjøring</SelectItem>
                  <SelectItem value="private">Privat</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {routeNote && <p className="text-xs text-amber-600">{routeNote}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Prosjekt</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Ingen" />
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
            <div className="space-y-1.5">
              <Label>Kjøretøy</Label>
              <Select value={vehicleId} onValueChange={setVehicleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Ingen" />
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
          </div>

          {canViewAll && (
            <div className="space-y-1.5">
              <Label>Sjåfør</Label>
              <Select value={driverUserId} onValueChange={setDriverUserId}>
                <SelectTrigger>
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

          <div className="space-y-1.5">
            <Label htmlFor="trip-purpose">Formål</Label>
            <Input
              id="trip-purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="F.eks. befaring, levering, kundemøte"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="trip-passengers">Passasjerer</Label>
              <Input
                id="trip-passengers"
                type="number"
                min={0}
                value={passengers}
                onChange={(e) => setPassengers(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 sm:col-span-2">
              <div>
                <Label htmlFor="trip-anleggsvei">Anleggsvei</Label>
                <p className="text-xs text-muted-foreground">+1 kr/km på skogs-/anleggsvei</p>
              </div>
              <Switch id="trip-anleggsvei" checked={anleggsvei} onCheckedChange={setAnleggsvei} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="odo-start">Km-stand start (valgfritt)</Label>
              <Input id="odo-start" type="number" min={0} value={odometerStart} onChange={(e) => setOdometerStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="odo-end">Km-stand slutt (valgfritt)</Label>
              <Input id="odo-end" type="number" min={0} value={odometerEnd} onChange={(e) => setOdometerEnd(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="trip-notes">Notat</Label>
            <Textarea id="trip-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <div className="space-y-1.5 rounded-lg bg-muted/50 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {classification === "private" ? "Beløp (ikke refunderbart)" : "Beregnet beløp"}
              </span>
              <span className="text-lg font-semibold tabular-nums">
                {amount.amountNok.toLocaleString("nb-NO", { style: "currency", currency: "NOK" })}
              </span>
            </div>
            {fuel.costNok > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  Drivstoff (anslag · {selectedVehicle?.fuel_consumption_l_per_mil} l/mil)
                </span>
                <span className="tabular-nums">
                  {fuel.costNok.toLocaleString("nb-NO", { style: "currency", currency: "NOK" })}
                </span>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <ResponsiveDialogFooter className="px-4 sm:px-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Avbryt
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {editingTrip ? "Lagre endringer" : "Lagre kjøretur"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
