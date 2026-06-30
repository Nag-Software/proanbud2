"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { toast } from "sonner"
import {
  Building2,
  Check,
  Clock,
  Crosshair,
  Flame,
  Layers,
  Loader2,
  MapPin,
  Navigation,
  Pencil,
  Route,
  Search,
  Users,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { GeocodeAutocomplete } from "@/components/kjorebok/geocode-autocomplete"
import { cn } from "@/lib/utils"
import {
  geocodeMissingKartAction,
  getKartDataAction,
  getKartOpsAction,
  getKjorebokRoutesAction,
  resetProjectGeofenceAction,
  setProjectGeofenceAction,
  setProjectSiteAddressAction,
  type KartCustomer,
  type KartGeofence,
  type KartOps,
  type KartProject,
  type KartTrip,
} from "./actions"

import type { Basemap } from "@/components/kart/kart-map"

const KartMap = dynamic(() => import("@/components/kart/kart-map"), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-muted/30 text-sm text-muted-foreground">
      Laster kart…
    </div>
  ),
})

const STATUS_LABEL: Record<string, string> = {
  planning: "Planlegging",
  active: "Aktiv",
  on_hold: "På vent",
  completed: "Fullført",
}
const STATUS_DOT: Record<string, string> = {
  active: "bg-green-600",
  planning: "bg-amber-600",
  on_hold: "bg-slate-500",
  completed: "bg-slate-500",
}

type Filter = "alle" | "aktive" | "paaplass" | "avvik"

function statusLabel(s: string) {
  return STATUS_LABEL[s] ?? s
}
function statusDot(s: string) {
  return STATUS_DOT[s] ?? "bg-blue-600"
}

const EMPTY_OPS: KartOps = { projectId: "", crew: [], hoursToday: 0, openAvvik: 0, overdueTasks: 0 }

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function clockHHMM(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Oslo" })
}

function fmtHoursShort(h: number): string {
  return h.toLocaleString("nb-NO", { maximumFractionDigits: 1 })
}

function fmtKr(n: number | null): string {
  if (!n) return "–"
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} M kr`
  if (n >= 1000) return `${Math.round(n / 1000)}k kr`
  return `${Math.round(n)} kr`
}

function deadlineLabel(endDate: string | null): { text: string; danger: boolean } | null {
  if (!endDate) return null
  const d = new Date(`${endDate}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000)
  const dateStr = d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })
  if (days < 0) return { text: `Frist ${dateStr} · forfalt`, danger: true }
  if (days === 0) return { text: `Frist i dag`, danger: true }
  if (days <= 7) return { text: `Frist ${dateStr} · ${days} d igjen`, danger: false }
  return { text: `Frist ${dateStr}`, danger: false }
}

export function KartClient({
  initialProjects,
  initialCustomers,
  initialGeofences,
  initialOps,
}: {
  initialProjects: KartProject[]
  initialCustomers: KartCustomer[]
  initialGeofences: KartGeofence[]
  initialOps: KartOps[]
}) {
  const [projects, setProjects] = useState(initialProjects)
  const [customers, setCustomers] = useState(initialCustomers)
  const [geofences, setGeofences] = useState(initialGeofences)
  const [ops, setOps] = useState(initialOps)
  const [liveAt, setLiveAt] = useState<Date | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCustomers, setShowCustomers] = useState(false)
  const [showGeofences, setShowGeofences] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [showTrips, setShowTrips] = useState(false)
  const [trips, setTrips] = useState<KartTrip[]>([])
  const [tripsLoaded, setTripsLoaded] = useState(false)
  const [tripsLoading, setTripsLoading] = useState(false)
  const [basemap, setBasemap] = useState<Basemap>("standard")
  const [filter, setFilter] = useState<Filter>("alle")
  const [query, setQuery] = useState("")
  const [geocoding, setGeocoding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftAddress, setDraftAddress] = useState("")
  const [draftCoords, setDraftCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [savingAddress, setSavingAddress] = useState(false)
  const [geoEditing, setGeoEditing] = useState(false)
  const [geoCenter, setGeoCenter] = useState<{ lat: number; lng: number } | null>(null)
  const [geoRadius, setGeoRadius] = useState(100)
  const [geoSaving, setGeoSaving] = useState(false)

  const opsById = useMemo(() => new Map(ops.map((o) => [o.projectId, o])), [ops])

  // Lightweight per-pin badge counts (crew on site + open avvik).
  const badges = useMemo(() => {
    const m = new Map<string, { crew: number; avvik: number }>()
    for (const o of ops) m.set(o.projectId, { crew: o.crew.length, avvik: o.openAvvik })
    return m
  }, [ops])

  const totals = useMemo(() => {
    let crew = 0
    let avvik = 0
    for (const o of ops) {
      crew += o.crew.length
      avvik += o.openAvvik
    }
    return { crew, avvik }
  }, [ops])

  // --- live poll: refresh just the ops slice so the map stays current ---
  const refreshOps = useCallback(async () => {
    try {
      const next = await getKartOpsAction()
      setOps(next)
      setLiveAt(new Date())
    } catch {
      // keep the last good snapshot; the next tick retries
    }
  }, [])

  useEffect(() => {
    setLiveAt(new Date())
    const id = setInterval(refreshOps, 45_000)
    const onFocus = () => refreshOps()
    window.addEventListener("focus", onFocus)
    return () => {
      clearInterval(id)
      window.removeEventListener("focus", onFocus)
    }
  }, [refreshOps])

  // Lazy-load kjørebok routes the first time the layer is turned on.
  useEffect(() => {
    if (!showTrips || tripsLoaded || tripsLoading) return
    setTripsLoading(true)
    getKjorebokRoutesAction()
      .then((t) => {
        setTrips(t)
        setTripsLoaded(true)
        if (t.length === 0) toast.info("Ingen kjørte ruter siste 30 dager")
      })
      .catch(() => toast.error("Kunne ikke hente ruter"))
      .finally(() => setTripsLoading(false))
  }, [showTrips, tripsLoaded, tripsLoading])

  // Leave geofence-edit mode whenever the selected project changes.
  useEffect(() => {
    setGeoEditing(false)
  }, [selectedId])

  const plottable = useMemo(() => projects.filter((p) => p.lat != null && p.lng != null), [projects])

  const missing = useMemo(() => {
    const fenceIds = new Set(geofences.map((g) => g.projectId))
    const missingCoords =
      projects.filter((p) => p.lat == null).length + customers.filter((c) => c.lat == null).length
    const missingGeofence = projects.filter(
      (p) => p.lat != null && p.lng != null && !fenceIds.has(p.id)
    ).length
    return missingCoords + missingGeofence
  }, [projects, customers, geofences])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = projects.filter((p) => {
      const o = opsById.get(p.id)
      if (filter === "aktive" && p.status !== "active") return false
      if (filter === "paaplass" && !(o && o.crew.length > 0)) return false
      if (filter === "avvik" && !(o && o.openAvvik > 0)) return false
      if (q && !(p.name.toLowerCase().includes(q) || (p.address ?? "").toLowerCase().includes(q))) return false
      return true
    })
    // Plottable first, then the rest (so the list mirrors what's on the map).
    return [...list].sort((a, b) => (a.lat != null ? 0 : 1) - (b.lat != null ? 0 : 1))
  }, [projects, query, filter, opsById])

  const selected = useMemo(() => projects.find((p) => p.id === selectedId) ?? null, [projects, selectedId])
  const selectedOps = selected ? opsById.get(selected.id) ?? EMPTY_OPS : EMPTY_OPS

  async function handleGeocode() {
    setGeocoding(true)
    try {
      const res = await geocodeMissingKartAction()
      if (!res.ok) {
        toast.error(res.error || "Geokoding feilet")
        return
      }
      const data = await getKartDataAction()
      setProjects(data.projects)
      setCustomers(data.customers)
      setGeofences(data.geofences)
      setOps(data.ops)
      setLiveAt(new Date())
      const total = res.projectsGeocoded + res.customersGeocoded + res.geofencesBuilt
      if (total === 0) {
        toast.info("Kartet er allerede oppdatert")
      } else {
        const parts: string[] = []
        if (res.projectsGeocoded) parts.push(`${res.projectsGeocoded} prosjekt`)
        if (res.customersGeocoded) parts.push(`${res.customersGeocoded} kunder`)
        if (res.geofencesBuilt) parts.push(`${res.geofencesBuilt} geofence`)
        toast.success(`Oppdaterte ${parts.join(", ")}`)
      }
      if (res.remaining > 0) {
        toast.info(`${res.remaining} gjenstår — kjør «Oppdater kart» igjen`)
      }
    } catch {
      toast.error("Geokoding feilet")
    } finally {
      setGeocoding(false)
    }
  }

  function openEditor() {
    if (!selected) return
    setDraftAddress(selected.address ?? "")
    setDraftCoords(
      selected.lat != null && selected.lng != null ? { lat: selected.lat, lng: selected.lng } : null
    )
    setEditing(true)
  }

  async function saveAddress() {
    if (!selected) return
    const addr = draftAddress.trim()
    if (addr.length < 3) {
      toast.error("Skriv inn en adresse")
      return
    }
    setSavingAddress(true)
    try {
      const res = await setProjectSiteAddressAction(selected.id, addr, draftCoords?.lat, draftCoords?.lng)
      if (!res.ok) {
        toast.error(res.error || "Kunne ikke lagre")
        return
      }
      const data = await getKartDataAction()
      setProjects(data.projects)
      setCustomers(data.customers)
      setGeofences(data.geofences)
      setOps(data.ops)
      setEditing(false)
      if (res.lat == null) {
        toast.info("Lagret, men fant ingen posisjon for adressen")
      } else {
        toast.success("Byggeplassadresse oppdatert")
      }
    } catch {
      toast.error("Kunne ikke lagre")
    } finally {
      setSavingAddress(false)
    }
  }

  function startGeoEdit() {
    if (!selected) return
    const fence = geofences.find((g) => g.projectId === selected.id)
    const lat = fence?.centerLat ?? selected.lat
    const lng = fence?.centerLng ?? selected.lng
    if (lat == null || lng == null) {
      toast.error("Sett byggeplassadresse først")
      return
    }
    setGeoCenter({ lat, lng })
    setGeoRadius(fence?.radiusM ?? 100)
    setGeoEditing(true)
  }

  async function refreshKartData() {
    const data = await getKartDataAction()
    setProjects(data.projects)
    setCustomers(data.customers)
    setGeofences(data.geofences)
    setOps(data.ops)
    setLiveAt(new Date())
  }

  async function saveGeofence() {
    if (!selected || !geoCenter) return
    setGeoSaving(true)
    try {
      const res = await setProjectGeofenceAction(selected.id, geoCenter.lat, geoCenter.lng, geoRadius)
      if (!res.ok) {
        toast.error(res.error || "Kunne ikke lagre")
        return
      }
      await refreshKartData()
      setGeoEditing(false)
      toast.success("Geofence lagret")
    } catch {
      toast.error("Kunne ikke lagre")
    } finally {
      setGeoSaving(false)
    }
  }

  async function resetGeofence() {
    if (!selected) return
    setGeoSaving(true)
    try {
      const res = await resetProjectGeofenceAction(selected.id)
      if (!res.ok) {
        toast.error(res.error || "Kunne ikke tilbakestille")
        return
      }
      await refreshKartData()
      setGeoEditing(false)
      toast.success("Geofence tilbakestilt")
    } catch {
      toast.error("Kunne ikke tilbakestille")
    } finally {
      setGeoSaving(false)
    }
  }

  const hasAnyPlottable = plottable.length > 0
  const deadline = selected ? deadlineLabel(selected.endDate) : null

  return (
    <div className="relative h-full w-full overflow-hidden">
      <KartMap
        projects={projects}
        customers={customers}
        geofences={geofences}
        trips={trips}
        badges={badges}
        selectedId={selectedId}
        onSelect={setSelectedId}
        showCustomers={showCustomers}
        showGeofences={showGeofences}
        showHeatmap={showHeatmap}
        showTrips={showTrips}
        basemap={basemap}
        geoEdit={geoEditing && geoCenter ? { center: geoCenter, radiusM: geoRadius } : null}
        onGeoEditCenter={(lat, lng) => setGeoCenter({ lat, lng })}
      />

      {/* Left: filters + searchable project list */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 flex max-w-[88vw] flex-col p-3">
        <div className="pointer-events-auto flex max-h-full w-72 flex-col overflow-hidden rounded-xl border bg-background/95 shadow-lg backdrop-blur">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Søk prosjekt eller adresse"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <FilterChip active={filter === "alle"} onClick={() => setFilter("alle")}>
              Alle
            </FilterChip>
            <FilterChip active={filter === "aktive"} onClick={() => setFilter("aktive")}>
              Aktive
            </FilterChip>
            <FilterChip active={filter === "paaplass"} onClick={() => setFilter("paaplass")}>
              På plass{totals.crew > 0 ? ` ${totals.crew}` : ""}
            </FilterChip>
            <FilterChip active={filter === "avvik"} onClick={() => setFilter("avvik")} danger={totals.avvik > 0}>
              Avvik{totals.avvik > 0 ? ` ${totals.avvik}` : ""}
            </FilterChip>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Ingen prosjekter</p>
            ) : (
              filtered.map((p) => {
                const placed = p.lat != null && p.lng != null
                const o = opsById.get(p.id)
                const crew = o?.crew.length ?? 0
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60",
                      selectedId === p.id && "bg-muted"
                    )}
                  >
                    <span className={cn("size-2.5 shrink-0 rounded-full", statusDot(p.status))} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{p.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {statusLabel(p.status)}
                        {p.address ? ` · ${p.address}` : ""}
                      </span>
                    </span>
                    {crew > 0 ? (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-800">
                        <Users className="size-3" />
                        {crew}
                      </span>
                    ) : !placed ? (
                      <span className="shrink-0 text-[11px] text-muted-foreground">ikke plassert</span>
                    ) : null}
                  </button>
                )
              })
            )}
          </div>
          <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
            <span>
              {plottable.length} av {projects.length} på kartet
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-green-500 animate-pulse" />
              Live{liveAt ? ` ${clockHHMM(liveAt.toISOString())}` : ""}
            </span>
          </div>
        </div>
      </div>

      {/* Right: basemap + layer toggles + geocode */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <div className="flex overflow-hidden rounded-xl border bg-background/95 text-xs shadow-lg backdrop-blur">
          <BasemapButton active={basemap === "standard"} onClick={() => setBasemap("standard")}>
            Kart
          </BasemapButton>
          <BasemapButton active={basemap === "satellite"} onClick={() => setBasemap("satellite")}>
            Satellitt
          </BasemapButton>
          <BasemapButton active={basemap === "hybrid"} onClick={() => setBasemap("hybrid")}>
            Hybrid
          </BasemapButton>
        </div>
        <div className="flex gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur">
          <ToggleButton active={showCustomers} onClick={() => setShowCustomers((v) => !v)} title="Kunder">
            <Users className="size-4" />
          </ToggleButton>
          <ToggleButton active={showGeofences} onClick={() => setShowGeofences((v) => !v)} title="Geofencer">
            <Layers className="size-4" />
          </ToggleButton>
          <ToggleButton active={showHeatmap} onClick={() => setShowHeatmap((v) => !v)} title="Verdi-heatmap">
            <Flame className="size-4" />
          </ToggleButton>
          <ToggleButton active={showTrips} onClick={() => setShowTrips((v) => !v)} title="Kjørebok-ruter">
            {tripsLoading ? <Loader2 className="size-4 animate-spin" /> : <Route className="size-4" />}
          </ToggleButton>
        </div>
        {missing > 0 && (
          <Button size="sm" variant="secondary" className="shadow-lg" onClick={handleGeocode} disabled={geocoding}>
            {geocoding ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
            Oppdater kart ({missing})
          </Button>
        )}
      </div>

      {/* Empty state when nothing is geocoded yet */}
      {!hasAnyPlottable && (
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center p-4">
          <div className="pointer-events-auto max-w-sm rounded-xl border bg-background/95 p-6 text-center shadow-lg backdrop-blur">
            <MapPin className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 text-base font-medium text-foreground">Ingen prosjekter på kartet ennå</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Plasser prosjekt- og kundeadresser automatisk via Kartverket.
            </p>
            {missing > 0 && (
              <Button className="mt-4" onClick={handleGeocode} disabled={geocoding}>
                {geocoding ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
                Plasser adresser
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Bottom: selected project — live operations panel */}
      {selected && !geoEditing && (
        <div className="absolute bottom-3 left-1/2 z-10 w-[min(360px,92vw)] -translate-x-1/2 sm:left-auto sm:right-3 sm:translate-x-0">
          <div className="rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-medium text-foreground">{selected.name}</h3>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("size-2 rounded-full", statusDot(selected.status))} />
                  {statusLabel(selected.status)}
                  {selected.address ? ` · ${selected.address}` : ""}
                </p>
              </div>
              <button
                onClick={() => setSelectedId(null)}
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Lukk"
              >
                <X className="size-4" />
              </button>
            </div>

            {selected.lat == null ? (
              <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Ingen posisjon ennå. Sett byggeplassadressen for å plassere prosjektet på kartet.
              </p>
            ) : (
              <>
                {/* Live metric row */}
                <div className="mt-3 grid grid-cols-4 gap-1.5">
                  <Stat label="På plass" value={selectedOps.crew.length} tone={selectedOps.crew.length ? "green" : "muted"} />
                  <Stat label="Timer i dag" value={fmtHoursShort(selectedOps.hoursToday)} />
                  <Stat label="Avvik" value={selectedOps.openAvvik} tone={selectedOps.openAvvik ? "red" : "muted"} />
                  <Stat label="Forfalt" value={selectedOps.overdueTasks} tone={selectedOps.overdueTasks ? "amber" : "muted"} />
                </div>

                {/* Crew on site now */}
                {selectedOps.crew.length > 0 ? (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      På plass nå
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {selectedOps.crew.slice(0, 5).map((c) => (
                        <div key={c.userId} className="flex items-center gap-2">
                          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-medium text-primary">
                            {initials(c.name)}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
                          {c.gpsConfirmed && (
                            <MapPin className="size-3 text-green-600" aria-label="GPS-bekreftet på plass" />
                          )}
                          <span className="shrink-0 text-xs text-muted-foreground">
                            <Clock className="mr-1 inline size-3 align-[-2px]" />
                            {clockHHMM(c.since)}
                          </span>
                        </div>
                      ))}
                      {selectedOps.crew.length > 5 && (
                        <span className="text-xs text-muted-foreground">
                          +{selectedOps.crew.length - 5} flere
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-muted-foreground">Ingen på plass akkurat nå.</p>
                )}

                {/* Budget + deadline */}
                <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Budsjett {fmtKr(selected.budgetNok)}</span>
                  {deadline && (
                    <span className={cn(deadline.danger ? "font-medium text-red-600" : "text-muted-foreground")}>
                      {deadline.text}
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={startGeoEdit}
                  className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
                >
                  <Layers className="size-3.5" /> Juster geofence
                </button>
              </>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="flex-1" onClick={openEditor}>
                <Pencil className="size-4" />
                {selected.lat == null ? "Sett adresse" : "Endre adresse"}
              </Button>
              {selected.lat != null && selected.lng != null && (
                <Button asChild size="sm" variant="secondary" className="flex-1">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${selected.lat},${selected.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Navigation className="size-4" />
                    Naviger
                  </a>
                </Button>
              )}
              <Button asChild size="sm" variant="secondary" className="flex-1">
                <Link href={`/prosjekter/${selected.id}`}>
                  <Building2 className="size-4" />
                  Åpne prosjekt
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom: geofence editor (replaces the detail panel while editing) */}
      {selected && geoEditing && (
        <div className="absolute bottom-3 left-1/2 z-10 w-[min(360px,92vw)] -translate-x-1/2 sm:left-auto sm:right-3 sm:translate-x-0">
          <div className="rounded-xl border bg-background/95 p-4 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
                <Layers className="size-4 text-amber-500" /> Juster geofence
              </h3>
              <button
                onClick={() => setGeoEditing(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted disabled:opacity-50"
                aria-label="Lukk"
                disabled={geoSaving}
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{selected.name}</p>
            <p className="mt-3 text-xs text-muted-foreground">
              Dra den oransje prikken for å flytte midten. Juster radius under — geofencen avgjør når
              GPS regner en ansatt som «på plass».
            </p>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={20}
                max={500}
                step={5}
                value={geoRadius}
                onChange={(e) => setGeoRadius(Number(e.target.value))}
                className="flex-1"
                aria-label="Radius i meter"
              />
              <span className="w-14 shrink-0 text-right text-sm tabular-nums">{geoRadius} m</span>
            </div>
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={resetGeofence} disabled={geoSaving}>
                Tilbakestill til teig
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setGeoEditing(false)} disabled={geoSaving}>
                  Avbryt
                </Button>
                <Button size="sm" onClick={saveGeofence} disabled={geoSaving}>
                  {geoSaving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  Lagre
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit site address (centered so the autocomplete has room) */}
      {editing && selected && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Lukk"
            className="absolute inset-0 bg-background/40 backdrop-blur-[1px]"
            onClick={() => !savingAddress && setEditing(false)}
          />
          <div className="relative w-[min(420px,92vw)] rounded-xl border bg-background p-4 shadow-xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-medium text-foreground">Byggeplassadresse</h3>
              <button
                type="button"
                onClick={() => !savingAddress && setEditing(false)}
                className="rounded-md p-1 text-muted-foreground hover:bg-muted"
                aria-label="Lukk"
              >
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{selected.name}</p>
            <div className="mt-3">
              <GeocodeAutocomplete
                value={draftAddress}
                onChange={(v) => {
                  setDraftAddress(v)
                  setDraftCoords(null)
                }}
                onSelect={(r) => {
                  setDraftAddress(r.label)
                  setDraftCoords({ lat: r.lat, lng: r.lng })
                }}
                placeholder="Søk byggeplassadresse"
                endpoint="/api/geo/geocode"
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Adressen til selve byggeplassen — ikke kundens kontoradresse. Pinnen flyttes hit.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={savingAddress}>
                Avbryt
              </Button>
              <Button size="sm" onClick={saveAddress} disabled={savingAddress || draftAddress.trim().length < 3}>
                {savingAddress ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                Lagre
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: ReactNode
  tone?: "default" | "green" | "red" | "amber" | "muted"
}) {
  const toneClass =
    tone === "green"
      ? "bg-green-100 text-green-800"
      : tone === "red"
        ? "bg-red-100 text-red-800"
        : tone === "amber"
          ? "bg-amber-100 text-amber-800"
          : "bg-muted/60 text-foreground"
  return (
    <div className={cn("rounded-md px-2 py-1.5", toneClass)}>
      <p className="text-[10px] leading-tight opacity-80">{label}</p>
      <p className="text-base font-medium leading-tight">{value}</p>
    </div>
  )
}

function FilterChip({
  active,
  danger,
  onClick,
  children,
}: {
  active: boolean
  danger?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-foreground text-background"
          : danger
            ? "bg-red-100 text-red-800 hover:bg-red-200"
            : "text-muted-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}

function BasemapButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "px-2.5 py-1.5 transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}

function ToggleButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex size-8 items-center justify-center rounded-lg transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
      )}
    >
      {children}
    </button>
  )
}
