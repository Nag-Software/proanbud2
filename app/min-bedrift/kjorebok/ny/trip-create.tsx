"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import dynamic from "next/dynamic"
import { ArrowLeftIcon, ArrowUpDownIcon, ChevronDownIcon, FuelIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { reportClientError } from "@/lib/errors/client"
import { createTripAction, type TripFormContext } from "@/app/kjorebok/actions"
import { computeTripAmount } from "@/lib/kjorebok/rates"
import { computeFuelCost } from "@/lib/kjorebok/fuel"
import { GeocodeAutocomplete } from "@/components/kjorebok/geocode-autocomplete"
import {
  NEW_TRIP_DRAFT_KEY,
  type GeocodeResult,
  type LiveTripDraft,
  type LngLat,
  type RouteResult,
} from "@/lib/kjorebok/types"

const TripMap = dynamic(() => import("@/components/kjorebok/trip-map").then((m) => m.TripMap), {
  ssr: false,
})

const NONE = "__none__"
const OVERVIEW_PATH = "/min-bedrift/kjorebok"

type Props = {
  context: TripFormContext
  currentUserId: string
  /** Preselect a project (when launched from a project's Kjørebok tab). */
  defaultProjectId?: string | null
  /** Where to go on save/cancel. Defaults to the company kjørebok overview. */
  returnTo?: string
}

function todayIso() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function kr(n: number) {
  return n.toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 })
}

/**
 * Dedicated "Ny tur" page (replaces the old modal wizard). A large map sits on
 * the left with the from/to route-maker floating on top and the key figures
 * (distanse, godtgjørelse, drivstoff) anchored bottom-left in bold — no boxes.
 * The fields needed to file the trip run down a single column on the right.
 *
 * Used for brand-new trips and for finishing a GPS-tracked trip, which is handed
 * over via sessionStorage (NEW_TRIP_DRAFT_KEY) from the live tracker.
 */
export function TripCreate({ context, currentUserId, defaultProjectId, returnTo }: Props) {
  const router = useRouter()
  const { projects, drivers, vehicles, canViewAll } = context
  const returnPath = returnTo ?? OVERVIEW_PATH

  const [fromAddress, setFromAddress] = useState("")
  const [fromLat, setFromLat] = useState<number | null>(null)
  const [fromLng, setFromLng] = useState<number | null>(null)
  const [toAddress, setToAddress] = useState("")
  const [toLat, setToLat] = useState<number | null>(null)
  const [toLng, setToLng] = useState<number | null>(null)
  const [distanceKm, setDistanceKm] = useState("")
  const [routeGeometry, setRouteGeometry] = useState<LngLat[] | null>(null)
  const [routes, setRoutes] = useState<RouteResult[]>([])
  const [selectedRouteIdx, setSelectedRouteIdx] = useState(0)

  // A vehicle is required, so default to the current driver's car (or the first
  // available one) instead of "no vehicle".
  const [vehicleId, setVehicleId] = useState<string>(
    () => vehicles.find((v) => v.default_driver === currentUserId)?.id ?? vehicles[0]?.id ?? NONE
  )
  const [tripDate, setTripDate] = useState<string>(todayIso())
  const [projectId, setProjectId] = useState<string>(defaultProjectId || NONE)
  const [driverUserId, setDriverUserId] = useState<string>(currentUserId)
  const [startTime, setStartTime] = useState<string | null>(null)
  const [endTime, setEndTime] = useState<string | null>(null)
  const [source, setSource] = useState<"manual" | "gps">("manual")

  const [routing, setRouting] = useState(false)
  const [routeNote, setRouteNote] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Mobile-only: the optional fields collapse behind a "Flere detaljer" toggle so
  // the default screen is just the map + from/to + Lagre. Desktop always shows them.
  const [showMore, setShowMore] = useState(false)

  // Hydrate from a handed-over GPS draft (live tracker → this page), then clear it
  // so a refresh starts a clean manual trip.
  useEffect(() => {
    let draft: LiveTripDraft | null = null
    try {
      const raw = sessionStorage.getItem(NEW_TRIP_DRAFT_KEY)
      if (raw) {
        draft = JSON.parse(raw) as LiveTripDraft
        sessionStorage.removeItem(NEW_TRIP_DRAFT_KEY)
      }
    } catch {
      /* ignore malformed/blocked storage */
    }
    if (!draft) return
    setFromAddress(draft.fromAddress ?? "")
    setFromLat(draft.fromLat ?? null)
    setFromLng(draft.fromLng ?? null)
    setToAddress(draft.toAddress ?? "")
    setToLat(draft.toLat ?? null)
    setToLng(draft.toLng ?? null)
    setDistanceKm(String(draft.distanceKm))
    setRouteGeometry(draft.routeGeometry ?? null)
    setTripDate(draft.startTime.slice(0, 10))
    setStartTime(draft.startTime)
    setEndTime(draft.endTime)
    setSource("gps")
  }, [])

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

  function applyRoute(r: RouteResult) {
    setDistanceKm(String(r.distanceKm))
    setRouteGeometry(Array.isArray(r.geometry) ? r.geometry : null)
  }

  // Pick one of the alternatives (clicked on the map): updates distance + line.
  function selectRoute(idx: number) {
    const r = routes[idx]
    if (!r) return
    setSelectedRouteIdx(idx)
    applyRoute(r)
  }

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
      const list: RouteResult[] = Array.isArray(data?.routes) ? data.routes : []
      if (list.length > 0) {
        setRoutes(list)
        setSelectedRouteIdx(0)
        applyRoute(list[0])
        if (list[0].source === "haversine") setRouteNote("Anslått luftlinje – juster ved behov.")
      } else if (typeof data?.distanceKm === "number") {
        // Defensive fallback if the API ever omits `routes`.
        setRoutes([])
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

  function goBack() {
    router.push(returnPath)
  }

  async function handleSubmit() {
    setError(null)
    if (!Number.isFinite(kmNum) || kmNum <= 0) {
      setError("Søk opp fra/til på kartet, eller legg inn distanse under «Flere detaljer».")
      setShowMore(true)
      return
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tripDate)) {
      setError("Velg en gyldig dato")
      setShowMore(true)
      return
    }
    if (vehicles.length > 0 && vehicleId === NONE) {
      setError("Velg kjøretøy")
      setShowMore(true)
      return
    }
    setSubmitting(true)
    try {
      await createTripAction({
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
        purpose: null,
        classification: "business",
        passengers: 0,
        anleggsvei: false,
        routeGeometry,
        source,
      })
      toast.success("Kjøretur lagret")
      router.push(returnPath)
    } catch (e) {
      reportClientError(e, { context: { action: "lagre kjøretur" } })
      setError(e instanceof Error ? e.message : "Kunne ikke lagre kjøretur")
      setSubmitting(false)
    }
  }

  const mapFrom = fromLat != null && fromLng != null ? { lat: fromLat, lng: fromLng } : null
  const mapTo = toLat != null && toLng != null ? { lat: toLat, lng: toLng } : null
  const hasBothPoints = mapFrom != null && mapTo != null

  // A worker (no company-wide view) may only file their own trips. When they open
  // this from a project's Kjørebok tab, the driver is locked to them and the trip
  // is fixed to that project — both shown read-only rather than as editable inputs.
  const ownDriverName = drivers.find((d) => d.id === currentUserId)?.name ?? "Deg"
  const lockProjectToCurrent = !canViewAll && projectId !== NONE
  const lockedProjectName = projects.find((p) => p.id === projectId)?.name ?? "Dette prosjektet"

  // Short summary of the defaulted optional fields, shown on the collapsed mobile toggle.
  const driverLabel = canViewAll ? drivers.find((d) => d.id === driverUserId)?.name ?? "Sjåfør" : ownDriverName
  const detailSummary = [
    tripDate === todayIso() ? "I dag" : tripDate,
    driverLabel,
    selectedVehicle?.name,
    projectId !== NONE ? projects.find((p) => p.id === projectId)?.name : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header — hidden on mobile, where the app shell already shows a back arrow + title. */}
      <div className="hidden shrink-0 items-center gap-3 px-3 pt-3 sm:px-4 sm:pt-4 lg:flex">
        <Button variant="ghost" size="icon" onClick={goBack} title="Tilbake til kjørebok" className="shrink-0">
          <ArrowLeftIcon className="size-5" />
        </Button>
        <h1 className="min-w-0 text-lg font-semibold tracking-tight sm:text-xl">Ny kjøretur</h1>
      </div>

      {/* Scrolls as one column on mobile; fixed two-column map+fields on desktop. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:overflow-hidden">
        <div className="flex flex-col gap-3 lg:grid lg:h-full lg:grid-cols-[minmax(0,1fr)_clamp(340px,30vw,440px)]">
          {/* MAP */}
          <div className="relative h-[52vh] min-h-[300px] shrink-0 overflow-hidden rounded-2xl border bg-muted lg:h-full lg:min-h-0">
            <TripMap
              routeGeometry={routeGeometry}
              routes={routes}
              selectedRouteIndex={selectedRouteIdx}
              onSelectRoute={selectRoute}
              from={mapFrom}
              to={mapTo}
              interactive
              className="absolute inset-0 h-full w-full"
            />

            {/* Route-maker — floating from/to card */}
            <div className="absolute inset-x-2 top-2 z-10 sm:inset-x-3 sm:top-3 sm:max-w-md">
              <div className="rounded-2xl border bg-background/95 p-2 shadow-xl ring-1 ring-black/5 backdrop-blur supports-backdrop-filter:bg-background/80">
                <div className="flex items-stretch gap-1.5">
                  <div className="flex flex-1 flex-col">
                    <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-0.5 transition-colors focus-within:bg-muted/70">
                      <span className="size-3 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
                      <GeocodeAutocomplete
                        value={fromAddress}
                        onChange={(v) => {
                          setFromAddress(v)
                          setFromLat(null)
                          setFromLng(null)
                        }}
                        onSelect={onPickFrom}
                        placeholder="Fra hvor?"
                        inputClassName="h-11 border-0 bg-transparent px-0 text-base shadow-none focus-visible:border-0 focus-visible:ring-0 sm:text-sm dark:bg-transparent"
                      />
                    </div>
                    <div className="ml-[1.05rem] h-3.5 w-px border-l border-dashed border-muted-foreground/40" />
                    <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-0.5 transition-colors focus-within:bg-muted/70">
                      <span className="size-3 shrink-0 rounded-[3px] bg-rose-500 ring-4 ring-rose-500/15" />
                      <GeocodeAutocomplete
                        value={toAddress}
                        onChange={(v) => {
                          setToAddress(v)
                          setToLat(null)
                          setToLng(null)
                        }}
                        onSelect={onPickTo}
                        placeholder="Til hvor?"
                        inputClassName="h-11 border-0 bg-transparent px-0 text-base shadow-none focus-visible:border-0 focus-visible:ring-0 sm:text-sm dark:bg-transparent"
                      />
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 self-center text-muted-foreground hover:text-foreground"
                    onClick={swapEndpoints}
                    title="Bytt fra/til"
                  >
                    <ArrowUpDownIcon className="size-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* KPIs — bottom-left, bold, on a dark gradient scrim so white text stays readable over any map tiles. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/80 via-black/45 to-transparent p-3.5 pt-16">
              <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
                <Kpi
                  label="Distanse"
                  value={
                    routing ? (
                      <Loader2Icon className="size-5 animate-spin" />
                    ) : kmNum > 0 ? (
                      `${kmNum.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} km`
                    ) : (
                      "—"
                    )
                  }
                />
                <Kpi label="Godtgjørelse" value={kmNum > 0 ? kr(amount.amountNok) : "—"} />
                <Kpi
                  label="Drivstoff"
                  value={fuel.costNok > 0 ? kr(fuel.costNok) : "—"}
                  hint={
                    vehicleId === NONE ? "Velg kjøretøy" : fuel.costNok === 0 ? "Mangler forbruk" : undefined
                  }
                />
              </div>
            </div>
          </div>

          {/* FIELDS */}
          <div className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card">
            {/* Mobile-only disclosure: keeps the default screen to just map + from/to + Lagre. */}
            <button
              type="button"
              onClick={() => setShowMore((s) => !s)}
              aria-expanded={showMore}
              className="flex items-center gap-3 p-4 text-left lg:hidden"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  Flere detaljer <span className="font-normal text-muted-foreground">(valgfritt)</span>
                </span>
                {!showMore && detailSummary && (
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{detailSummary}</span>
                )}
              </span>
              <ChevronDownIcon
                className={cn(
                  "size-5 shrink-0 text-muted-foreground transition-transform",
                  showMore && "rotate-180"
                )}
              />
            </button>

            <div
              className={cn(
                "space-y-4 px-4 pb-4 lg:block lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:p-4",
                showMore ? "block" : "hidden"
              )}
            >
              {routeNote && <p className="text-xs text-amber-600">{routeNote}</p>}

              <div className="space-y-1.5">
                <Label>Kjøretøy</Label>
                {vehicles.length === 0 ? (
                  <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                    Ingen kjøretøy ennå. Legg til under «Kjøretøy» i kjøreboken.
                  </p>
                ) : (
                  <Select value={vehicleId} onValueChange={onSelectVehicle}>
                    <SelectTrigger className="h-11 w-full sm:h-9">
                      <SelectValue placeholder="Velg kjøretøy" />
                    </SelectTrigger>
                    <SelectContent>
                      {vehicles.map((v) => (
                        <SelectItem key={v.id} value={v.id}>
                          {v.name}
                          {v.registration ? ` (${v.registration})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedVehicle && fuel.costNok > 0 && (
                  <p className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                    <FuelIcon className="size-3.5" />
                    {fuel.liters.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} liter ·{" "}
                    {fuel.pricePerLiter} kr/l ({selectedVehicle.fuel_consumption_l_per_mil} l/mil)
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="trip-date">Dato</Label>
                <Input
                  id="trip-date"
                  type="date"
                  className="h-11 sm:h-9"
                  value={tripDate}
                  max={todayIso()}
                  onChange={(e) => setTripDate(e.target.value)}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="trip-distance">Distanse (km)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="trip-distance"
                    inputMode="decimal"
                    className="h-11 sm:h-9"
                    value={distanceKm}
                    onChange={(e) => setDistanceKm(e.target.value)}
                    placeholder="0"
                  />
                  {hasBothPoints && (
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 shrink-0 sm:h-9"
                      size="sm"
                      onClick={() => void recalcRoute(fromLat!, fromLng!, toLat!, toLng!)}
                      disabled={routing}
                    >
                      {routing ? <Loader2Icon className="size-4 animate-spin" /> : "Beregn rute"}
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Prosjekt</Label>
                {lockProjectToCurrent ? (
                  <div className="flex h-11 w-full items-center rounded-md border bg-muted/40 px-3 text-sm sm:h-9">
                    {lockedProjectName}
                  </div>
                ) : (
                  <SearchableSelect
                    value={projectId}
                    onChange={setProjectId}
                    searchPlaceholder="Søk etter prosjekt…"
                    options={[
                      { value: NONE, label: "Uten prosjekt" },
                      ...projects.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Sjåfør</Label>
                {canViewAll ? (
                  <SearchableSelect
                    value={driverUserId}
                    onChange={setDriverUserId}
                    searchPlaceholder="Søk etter sjåfør…"
                    options={drivers.map((d) => ({ value: d.id, label: d.name ?? "Ukjent" }))}
                  />
                ) : (
                  <div className="flex h-11 w-full items-center rounded-md border bg-muted/40 px-3 text-sm sm:h-9">
                    {ownDriverName}
                  </div>
                )}
              </div>

              {/* Error shown here on desktop; mobile surfaces it above the sticky bar. */}
              {error && <p className="hidden text-sm text-destructive lg:block">{error}</p>}
            </div>

            {/* Desktop action bar (mobile uses the sticky bar below). */}
            <div className="hidden shrink-0 items-center justify-end gap-2 border-t bg-muted/40 p-3 lg:flex">
              <Button variant="outline" onClick={goBack} disabled={submitting}>
                Avbryt
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
                Lagre tur
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile sticky action bar — big thumb-friendly Lagre, always visible. */}
      {error && (
        <p className="shrink-0 bg-background px-3 pt-2 text-center text-sm text-destructive lg:hidden">{error}</p>
      )}
      <div className="flex shrink-0 items-center gap-2 border-t bg-background p-3 lg:hidden">
        <Button variant="outline" className="h-12" onClick={goBack} disabled={submitting}>
          Avbryt
        </Button>
        <Button className="h-12 flex-1 text-base" onClick={handleSubmit} disabled={submitting}>
          {submitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
          Lagre tur
        </Button>
      </div>
    </div>
  )
}

function Kpi({
  label,
  value,
  hint,
}: {
  label: string
  value: React.ReactNode
  hint?: string
}) {
  return (
    <div className="min-w-0 [text-shadow:0_1px_3px_rgba(0,0,0,0.7)]">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-white/75">{label}</p>
      <p className="flex items-center text-xl font-bold leading-tight tabular-nums text-white sm:text-2xl">
        {value}
      </p>
      {hint && <p className="text-[10px] leading-tight text-white/70">{hint}</p>}
    </div>
  )
}
