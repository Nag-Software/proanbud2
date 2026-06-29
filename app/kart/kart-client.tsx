"use client"

import { useMemo, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { toast } from "sonner"
import {
  Building2,
  Check,
  Crosshair,
  Layers,
  Loader2,
  MapPin,
  Pencil,
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
  setProjectSiteAddressAction,
  type KartCustomer,
  type KartProject,
} from "./actions"

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

function statusLabel(s: string) {
  return STATUS_LABEL[s] ?? s
}
function statusDot(s: string) {
  return STATUS_DOT[s] ?? "bg-blue-600"
}

export function KartClient({
  initialProjects,
  initialCustomers,
}: {
  initialProjects: KartProject[]
  initialCustomers: KartCustomer[]
}) {
  const [projects, setProjects] = useState(initialProjects)
  const [customers, setCustomers] = useState(initialCustomers)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCustomers, setShowCustomers] = useState(false)
  const [showGeofences, setShowGeofences] = useState(false)
  const [query, setQuery] = useState("")
  const [geocoding, setGeocoding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draftAddress, setDraftAddress] = useState("")
  const [draftCoords, setDraftCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [savingAddress, setSavingAddress] = useState(false)

  const plottable = useMemo(
    () => projects.filter((p) => p.lat != null && p.lng != null),
    [projects]
  )
  const missing = useMemo(
    () =>
      projects.filter((p) => p.lat == null).length +
      customers.filter((c) => c.lat == null).length,
    [projects, customers]
  )
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            (p.address ?? "").toLowerCase().includes(q)
        )
      : projects
    // Plottable first, then the rest (so the list mirrors what's on the map).
    return [...list].sort((a, b) => {
      const ap = a.lat != null ? 0 : 1
      const bp = b.lat != null ? 0 : 1
      return ap - bp
    })
  }, [projects, query])

  const selected = useMemo(
    () => projects.find((p) => p.id === selectedId) ?? null,
    [projects, selectedId]
  )

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
      const total = res.projectsGeocoded + res.customersGeocoded
      if (total === 0) {
        toast.info("Fant ingen nye adresser å plassere")
      } else {
        toast.success(
          `Plasserte ${res.projectsGeocoded} prosjekt og ${res.customersGeocoded} kunder på kartet`
        )
      }
      if (res.remaining > 0) {
        toast.info(`${res.remaining} gjenstår — kjør «Plasser adresser» igjen`)
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
      selected.lat != null && selected.lng != null
        ? { lat: selected.lat, lng: selected.lng }
        : null
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
      setProjects((prev) =>
        prev.map((p) =>
          p.id === selected.id ? { ...p, address: res.address, lat: res.lat, lng: res.lng } : p
        )
      )
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

  const hasAnyPlottable = plottable.length > 0

  return (
    <div className="relative h-full w-full overflow-hidden">
      <KartMap
        projects={projects}
        customers={customers}
        selectedId={selectedId}
        onSelect={setSelectedId}
        showCustomers={showCustomers}
        showGeofences={showGeofences}
      />

      {/* Left: searchable project list */}
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
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                Ingen prosjekter
              </p>
            ) : (
              filtered.map((p) => {
                const placed = p.lat != null && p.lng != null
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
                    {!placed && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">ikke plassert</span>
                    )}
                  </button>
                )
              })
            )}
          </div>
          <div className="border-t px-3 py-2 text-xs text-muted-foreground">
            {plottable.length} av {projects.length} prosjekter på kartet
          </div>
        </div>
      </div>

      {/* Right: layer toggles + geocode */}
      <div className="absolute right-3 top-3 z-10 flex flex-col items-end gap-2">
        <div className="flex gap-1 rounded-xl border bg-background/95 p-1 shadow-lg backdrop-blur">
          <ToggleButton active={showCustomers} onClick={() => setShowCustomers((v) => !v)} title="Kunder">
            <Users className="size-4" />
          </ToggleButton>
          <ToggleButton active={showGeofences} onClick={() => setShowGeofences((v) => !v)} title="Geofencer">
            <Layers className="size-4" />
          </ToggleButton>
        </div>
        {missing > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="shadow-lg"
            onClick={handleGeocode}
            disabled={geocoding}
          >
            {geocoding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Crosshair className="size-4" />
            )}
            Plasser adresser ({missing})
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
                {geocoding ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Crosshair className="size-4" />
                )}
                Plasser adresser
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Bottom: selected project detail */}
      {selected && (
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
            {selected.lat == null && (
              <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                Ingen posisjon ennå. Sett byggeplassadressen for å plassere prosjektet på kartet.
              </p>
            )}
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="secondary" className="flex-1" onClick={openEditor}>
                <Pencil className="size-4" />
                {selected.lat == null ? "Sett adresse" : "Endre adresse"}
              </Button>
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
