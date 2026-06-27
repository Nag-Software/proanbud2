"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { NavigationIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { toast } from "sonner"
import { reportClientError } from "@/lib/errors/client"
import { deleteTripAction, getCompanyTripsOverviewAction } from "@/app/kjorebok/actions"
import { TripFormDialog } from "@/components/kjorebok/trip-form-dialog"
import { TripWizard } from "@/components/kjorebok/trip-wizard"
import { LiveTracker } from "@/components/kjorebok/live-tracker"
import type { LiveTripDraft, TripsOverview, TripWithRefs } from "@/lib/kjorebok/types"

function kr(n: number) {
  return n.toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 })
}

const EMPTY: TripsOverview = {
  canViewAll: false,
  totals: { km: 0, amountNok: 0, fuelCostNok: 0, businessKm: 0, privateKm: 0, tripCount: 0, driverCount: 0 },
  trips: [],
  byProject: [],
  byDriver: [],
  drivers: [],
  projects: [],
  vehicles: [],
}

export default function KjorebokTab({
  projectId,
  currentUserId,
}: {
  projectId: string
  canViewAllEntries?: boolean
  currentUserId: string
}) {
  const confirm = useConfirm()
  const [overview, setOverview] = useState<TripsOverview>(EMPTY)
  const [formOpen, setFormOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editingTrip, setEditingTrip] = useState<TripWithRefs | null>(null)
  const [gpsDraft, setGpsDraft] = useState<LiveTripDraft | null>(null)
  const [trackerOpen, setTrackerOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setOverview(await getCompanyTripsOverviewAction({ projectId }))
    } catch (e) {
      reportClientError(e, { context: { action: "hente kjørebok for prosjekt", projectId } })
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  const { totals, trips, drivers, vehicles, projects, canViewAll } = overview

  async function onDelete(trip: TripWithRefs) {
    if (
      !(await confirm({
        title: "Slette kjøretur?",
        description: "Denne handlingen kan ikke angres.",
        variant: "destructive",
        confirmText: "Slett",
      }))
    )
      return
    try {
      await deleteTripAction(trip.id)
      toast.success("Kjøretur slettet")
      void load()
    } catch (e) {
      reportClientError(e, { context: { action: "slette kjøretur", projectId } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3">
        <div>
          <h3 className="font-semibold">Kjørebok</h3>
          <p className="text-sm text-muted-foreground">
            {totals.tripCount} turer · {totals.businessKm.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} km
            yrke · {kr(totals.amountNok)}
            {totals.fuelCostNok > 0 ? ` · ⛽ ${kr(totals.fuelCostNok)}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTrackerOpen(true)}>
            <NavigationIcon className="size-4" /> Start kjøring
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setGpsDraft(null)
              setWizardOpen(true)
            }}
          >
            <PlusIcon className="size-4" /> Ny tur
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        <table className="hidden w-full text-sm md:table">
          <thead className="border-b bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Dato</th>
              <th className="px-4 py-2 text-left font-medium">Strekning</th>
              {canViewAll && <th className="px-4 py-2 text-left font-medium">Sjåfør</th>}
              <th className="px-4 py-2 text-right font-medium">Km</th>
              <th className="px-4 py-2 text-right font-medium">Beløp</th>
              <th className="px-4 py-2 text-right font-medium">Drivstoff</th>
              <th className="px-4 py-2 text-left font-medium">Type</th>
              <th className="px-4 py-2 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {trips.length === 0 ? (
              <tr>
                <td colSpan={canViewAll ? 8 : 7} className="px-4 py-8 text-center text-muted-foreground">
                  Ingen kjøreturer på dette prosjektet ennå.
                </td>
              </tr>
            ) : (
              trips.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-4 py-2">
                    {format(new Date(t.trip_date), "d. MMM yyyy", { locale: nb })}
                  </td>
                  <td className="px-4 py-2">
                    <span className="line-clamp-1">
                      {t.from_address || "—"} {t.to_address ? `→ ${t.to_address}` : ""}
                    </span>
                  </td>
                  {canViewAll && <td className="px-4 py-2">{t.driver_name || "Ukjent"}</td>}
                  <td className="px-4 py-2 text-right tabular-nums">
                    {Number(t.distance_km).toLocaleString("nb-NO", { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{kr(Number(t.amount_nok))}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                    {Number(t.fuel_cost_nok) > 0 ? kr(Number(t.fuel_cost_nok)) : "—"}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={t.classification === "private" ? "outline" : "secondary"}>
                      {t.classification === "private" ? "Privat" : "Yrke"}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setGpsDraft(null)
                          setEditingTrip(t)
                          setFormOpen(true)
                        }}
                      >
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => onDelete(t)}>
                        <Trash2Icon className="size-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="divide-y md:hidden">
          {trips.length === 0 ? (
            <div className="px-4 py-8 text-center text-muted-foreground">
              Ingen kjøreturer på dette prosjektet ennå.
            </div>
          ) : (
            trips.map((t) => (
              <div key={t.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between">
                  <p className="font-medium">
                    {Number(t.distance_km).toLocaleString("nb-NO", { maximumFractionDigits: 1 })} km · {kr(Number(t.amount_nok))}
                  </p>
                  <Badge variant={t.classification === "private" ? "outline" : "secondary"}>
                    {t.classification === "private" ? "Privat" : "Yrke"}
                  </Badge>
                </div>
                <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                  {t.from_address || "—"} {t.to_address ? `→ ${t.to_address}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(t.trip_date), "d. MMM yyyy", { locale: nb })}
                  {Number(t.fuel_cost_nok) > 0 ? ` · ⛽ ${kr(Number(t.fuel_cost_nok))}` : ""}
                  {canViewAll && t.driver_name ? ` · ${t.driver_name}` : ""}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setGpsDraft(null)
                      setEditingTrip(t)
                      setFormOpen(true)
                    }}
                  >
                    <PencilIcon className="size-3.5" /> Rediger
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => onDelete(t)}>
                    <Trash2Icon className="size-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <TripWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        projects={projects}
        drivers={drivers}
        vehicles={vehicles}
        canViewAll={canViewAll}
        currentUserId={currentUserId}
        defaultProjectId={projectId}
        gpsDraft={gpsDraft}
        onSaved={() => {
          toast.success("Kjøretur lagret")
          void load()
        }}
      />

      <TripFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projects={projects}
        drivers={drivers}
        vehicles={vehicles}
        canViewAll={canViewAll}
        currentUserId={currentUserId}
        defaultProjectId={projectId}
        editingTrip={editingTrip}
        onSaved={() => {
          toast.success("Kjøretur lagret")
          void load()
        }}
      />

      <ResponsiveDialog open={trackerOpen} onOpenChange={setTrackerOpen}>
        <ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <ResponsiveDialogHeader className="px-4 sm:px-0">
            <ResponsiveDialogTitle>Live kjøring</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Sporer ruten mens du kjører. Du fyller inn detaljer når du stopper.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="px-4 pb-4 sm:px-0">
            <LiveTracker
              onCancel={() => setTrackerOpen(false)}
              onComplete={(draft) => {
                setTrackerOpen(false)
                setGpsDraft(draft)
                setWizardOpen(true)
              }}
            />
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
