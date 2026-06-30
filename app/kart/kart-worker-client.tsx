"use client"

import { useCallback, useMemo, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { Building2, MapPin, Navigation, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { KartWorkerProject } from "./actions"
import type { Basemap } from "@/components/kart/kart-map"

// Read-only worker map: just the projects the håndverker is assigned to, as pins,
// with a bottom-sheet card on tap (navigate / open project). No live ops, no
// geofence/address editing, no kjørebok routes — those stay on the manager view.
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

const EMPTY_BADGES = new Map<string, { crew: number; avvik: number }>()

export function KartWorkerClient({ initialProjects }: { initialProjects: KartWorkerProject[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [basemap, setBasemap] = useState<Basemap>("standard")

  // selectedId drives the open/closed slide; sheetProject holds the card content
  // and is only ever set to a non-null project (in the select handler, never in
  // render or an effect) so it stays mounted while the sheet animates out.
  const [sheetProject, setSheetProject] = useState<KartWorkerProject | null>(null)
  const handleSelect = useCallback(
    (id: string | null) => {
      setSelectedId(id)
      if (id) {
        const p = initialProjects.find((x) => x.id === id)
        if (p) setSheetProject(p)
      }
    },
    [initialProjects]
  )

  const isOpen = selectedId != null
  const hasAnyPlottable = useMemo(
    () => initialProjects.some((p) => p.lat != null && p.lng != null),
    [initialProjects]
  )

  return (
    <div className="relative h-full w-full overflow-hidden">
      <KartMap
        projects={initialProjects}
        customers={[]}
        geofences={[]}
        trips={[]}
        badges={EMPTY_BADGES}
        selectedId={selectedId}
        onSelect={handleSelect}
        showCustomers={false}
        showGeofences={false}
        showHeatmap={false}
        showTrips={false}
        basemap={basemap}
        geoEdit={null}
      />

      {/* View-only basemap toggle (Kart / Satellitt / Hybrid). */}
      <div className="absolute right-3 top-3 z-10 flex overflow-hidden rounded-xl border bg-background/95 text-xs shadow-lg backdrop-blur">
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

      {/* Empty state when none of the worker's projects are placed yet. */}
      {!hasAnyPlottable && (
        <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center p-4">
          <div className="pointer-events-auto max-w-sm rounded-xl border bg-background/95 p-6 text-center shadow-lg backdrop-blur">
            <MapPin className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-3 text-base font-medium text-foreground">Ingen prosjekter på kartet ennå</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Prosjektene dine dukker opp her når prosjektlederen har plassert byggeplassen.
            </p>
          </div>
        </div>
      )}

      {/* Bottom sheet — slides up on pin tap, down on dismiss. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 z-20 flex justify-center px-3 pb-[calc(env(safe-area-inset-bottom)+5.25rem)] transition-transform duration-300 ease-out md:pb-3",
          isOpen ? "translate-y-0" : "pointer-events-none translate-y-[130%]"
        )}
      >
        {sheetProject && (
          <div className="pointer-events-auto w-full max-w-md rounded-2xl border bg-background/95 p-4 shadow-2xl backdrop-blur">
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-muted-foreground/30" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-base font-medium text-foreground">{sheetProject.name}</h3>
                <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={cn("size-2 shrink-0 rounded-full", statusDot(sheetProject.status))} />
                  <span className="truncate">
                    {statusLabel(sheetProject.status)}
                    {sheetProject.address ? ` · ${sheetProject.address}` : ""}
                  </span>
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

            <div className="mt-4 flex gap-2">
              {sheetProject.lat != null && sheetProject.lng != null && (
                <Button asChild variant="secondary" className="flex-1">
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${sheetProject.lat},${sheetProject.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Navigation className="size-4" />
                    Naviger
                  </a>
                </Button>
              )}
              <Button asChild className="flex-1">
                <Link href={`/prosjekter/${sheetProject.id}`}>
                  <Building2 className="size-4" />
                  Åpne prosjekt
                </Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
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
