"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { Clock, Loader2, MapPin, Navigation, Pencil, Play, Plus, Square, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ModuleGate } from "@/components/billing/module-gate"
import { TripFormDialog } from "@/components/kjorebok/trip-form-dialog"
import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { deleteTripAction, getCompanyTripsOverviewAction } from "@/app/kjorebok/actions"
import { getProjectTimeEntriesAction } from "@/app/timeforing/actions"
import { MODULE_PRICING } from "@/lib/billing/plans"
import { actionErrorMessage, reportClientError } from "@/lib/errors/client"
import type { TripsOverview, TripWithRefs } from "@/lib/kjorebok/types"
import { formatHours, sumHours, unwrapRelation, type TimeEntryRow } from "@/lib/time-tracking"
import { cn } from "@/lib/utils"

import { DriveTrackerDialog, newTripPath } from "./drive-tracker-dialog"
import { useProjectFocus, useProjectShell } from "./project-tabs-shell"
import { useProjectWorkSession } from "./project-work-session"

type Filter = "alle" | "timer" | "kjoring"

type LogRow =
  | { kind: "timer"; id: string; sortKey: number; entry: TimeEntryRow }
  | { kind: "kjoring"; id: string; sortKey: number; trip: TripWithRefs }

const EMPTY_TRIPS: TripsOverview = {
  canViewAll: false,
  totals: { km: 0, amountNok: 0, fuelCostNok: 0, businessKm: 0, privateKm: 0, tripCount: 0, driverCount: 0 },
  trips: [],
  byProject: [],
  byDriver: [],
  drivers: [],
  projects: [],
  vehicles: [],
}

function kr(n: number) {
  return n.toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 })
}

function km(n: number) {
  return `${n.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} km`
}

function dayLabel(value: string) {
  return format(new Date(value), "d. MMM yyyy", { locale: nb })
}

function timeRange(entry: TimeEntryRow) {
  if (!entry.started_at || !entry.ended_at) return null
  return `${format(new Date(entry.started_at), "HH:mm")}–${format(new Date(entry.ended_at), "HH:mm")}`
}

function tripRoute(trip: TripWithRefs) {
  return `${trip.from_address || "—"}${trip.to_address ? ` → ${trip.to_address}` : ""}`
}

/**
 * «Timer og kjøring»: arbeidsøkter og kjøreturer i én logg. Før var dette to
 * faner i hver sin gruppe (Timeføring under Arbeid, Kjørebok under Økonomi),
 * og begge ble mest åpnet for å trykke én knapp.
 *
 * Stemplingen bor nå i Registrer-menyen og pillen i prosjekttoppen. Her står
 * knappene også, men fanen er først og fremst loggen: hva er ført, av hvem.
 * Filteret ligger i `?del=` (timer | kjoring), så gamle lenker til
 * Timeføring og Kjørebok lander riktig.
 */
export default function TimerTab({
  projectId,
  currentUserId,
  canViewAllEntries,
  hasTimeforing,
  hasKjorebok,
  participantHours,
}: {
  projectId: string
  currentUserId: string
  canViewAllEntries: boolean
  hasTimeforing: boolean
  hasKjorebok: boolean
  /** Timer per person, bare for ledere. */
  participantHours: Array<{ userId: string; name: string; totalHours: number }>
}) {
  const router = useRouter()
  const confirm = useConfirm()
  const work = useProjectWorkSession()
  const focus = useProjectFocus("timer")
  const { setDel } = useProjectShell()

  const [entries, setEntries] = React.useState<TimeEntryRow[]>([])
  const [overview, setOverview] = React.useState<TripsOverview>(EMPTY_TRIPS)
  const [loaded, setLoaded] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [formOpen, setFormOpen] = React.useState(false)
  const [editingTrip, setEditingTrip] = React.useState<TripWithRefs | null>(null)
  const [trackerOpen, setTrackerOpen] = React.useState(false)

  const entriesVersion = work?.entriesVersion ?? 0

  const loadEntries = React.useCallback(async () => {
    if (!hasTimeforing) return
    try {
      const result = await getProjectTimeEntriesAction(projectId, canViewAllEntries)
      if (result.ok) setEntries(result.data as TimeEntryRow[])
      else setError(result.error)
    } catch (loadError) {
      reportClientError(loadError, { context: { action: "hente timeføringer", projectId } })
      setError("Fikk ikke hentet timene. Sjekk internettforbindelsen og prøv igjen.")
    }
  }, [projectId, canViewAllEntries, hasTimeforing])

  const loadTrips = React.useCallback(async () => {
    if (!hasKjorebok) return
    try {
      setOverview(await getCompanyTripsOverviewAction({ projectId }))
    } catch (loadError) {
      reportClientError(loadError, { context: { action: "hente kjørebok for prosjekt", projectId } })
      setError("Fikk ikke hentet kjøreturene. Sjekk internettforbindelsen og prøv igjen.")
    }
  }, [projectId, hasKjorebok])

  React.useEffect(() => {
    void Promise.all([loadEntries(), loadTrips()]).finally(() => setLoaded(true))
  }, [loadEntries, loadTrips])

  // Ny økt stemplet ut eller timer ført manuelt fra menyen → hent på nytt.
  React.useEffect(() => {
    if (entriesVersion > 0) void loadEntries()
  }, [entriesVersion, loadEntries])

  const both = hasTimeforing && hasKjorebok
  const filter: Filter = both && (focus.del === "timer" || focus.del === "kjoring") ? focus.del : "alle"

  const rows = React.useMemo<LogRow[]>(() => {
    const list: LogRow[] = []
    for (const entry of entries) {
      list.push({
        kind: "timer",
        id: entry.id,
        sortKey: new Date(entry.started_at ?? entry.entry_date).getTime(),
        entry,
      })
    }
    for (const trip of overview.trips) {
      const time = trip.start_time ? `T${trip.start_time}` : "T12:00"
      list.push({
        kind: "kjoring",
        id: trip.id,
        sortKey: new Date(`${trip.trip_date}${time}`).getTime() || new Date(trip.trip_date).getTime(),
        trip,
      })
    }
    return list.sort((a, b) => b.sortKey - a.sortKey)
  }, [entries, overview.trips])

  const visibleRows = rows.filter((row) => filter === "alle" || row.kind === filter)
  const canViewAllTrips = overview.canViewAll
  const showPerson = canViewAllEntries || canViewAllTrips
  const totalHours = sumHours(entries)
  const { totals } = overview

  async function onDeleteTrip(trip: TripWithRefs) {
    const ok = await confirm({
      title: "Slette kjøretur?",
      description: "Denne handlingen kan ikke angres.",
      variant: "destructive",
      confirmText: "Slett",
    })
    if (!ok) return
    try {
      await deleteTripAction(trip.id)
      toast.success("Kjøretur slettet")
      void loadTrips()
    } catch (deleteError) {
      reportClientError(deleteError, { context: { action: "slette kjøretur", projectId } })
      toast.error(actionErrorMessage(deleteError, "Kunne ikke slette"))
    }
  }

  function openTrip(trip: TripWithRefs) {
    setEditingTrip(trip)
    setFormOpen(true)
  }

  if (!hasTimeforing && !hasKjorebok) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <ModuleGate
          moduleName="Timeføring"
          monthlyPriceNok={MODULE_PRICING.timeforing}
          description="Registrer og følg arbeidstimer direkte på prosjektet."
        />
        <ModuleGate
          moduleName="Kjørebok"
          monthlyPriceNok={MODULE_PRICING.kjorebok}
          description="Før kjørebok med GPS eller manuelt — statens satser og Tripletex-eksport, direkte på prosjektet."
        />
      </div>
    )
  }

  const summary = [
    hasTimeforing ? `${formatHours(totalHours)} ført` : null,
    hasKjorebok ? `${km(totals.businessKm)} yrke · ${kr(totals.amountNok)}` : null,
  ]
    .filter(Boolean)
    .join(" · ")

  const counts = {
    alle: rows.length,
    timer: entries.length,
    kjoring: overview.trips.length,
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border px-4 py-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">
            {both ? "Timer og kjøring" : hasTimeforing ? "Timer" : "Kjørebok"}
          </h2>
          <p className="text-sm text-muted-foreground">{loaded ? summary : "Henter …"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {work &&
            (work.session ? (
              <Button size="sm" variant="outline" onClick={() => void work.stop()} disabled={work.busy !== null}>
                {work.busy === "stop" ? <Loader2 className="size-4 animate-spin" /> : <Square className="size-3.5" />}
                Stemple ut · {work.elapsedLabel}
              </Button>
            ) : (
              <>
                <Button size="sm" onClick={work.checkInWithGps} disabled={work.busy !== null}>
                  {work.busy === "gps" ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
                  {work.busy === "gps" ? "Henter posisjon …" : "Stemple inn på plassen"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => void work.startWithoutGps()} disabled={work.busy !== null}>
                  <Play className="size-3.5" />
                  Start uten GPS
                </Button>
              </>
            ))}
          {work && (
            <Button size="sm" variant="outline" onClick={work.openManual}>
              <Clock className="size-3.5" />
              Før timer
            </Button>
          )}
          {hasKjorebok && (
            <>
              <Button size="sm" variant="outline" onClick={() => setTrackerOpen(true)}>
                <Navigation className="size-3.5" />
                Start kjøring
              </Button>
              <Button size="sm" variant="outline" onClick={() => router.push(newTripPath(projectId))}>
                <Plus className="size-3.5" />
                Ny tur
              </Button>
            </>
          )}
        </div>
      </div>

      {canViewAllEntries && participantHours.length > 0 && filter !== "kjoring" && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Timer per person
          </span>
          {[...participantHours]
            .sort((a, b) => b.totalHours - a.totalHours)
            .map((person) => (
              <span key={person.userId} className="tabular-nums">
                {person.name} <span className="font-semibold">{formatHours(person.totalHours)}</span>
              </span>
            ))}
        </div>
      )}

      {both && rows.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter">
          {(
            [
              { value: "alle", label: "Alle" },
              { value: "timer", label: "Timer" },
              { value: "kjoring", label: "Kjøring" },
            ] as const
          ).map((option) => {
            const active = filter === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setDel(option.value === "alle" ? null : option.value)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border px-3 text-[13px] font-medium transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border bg-background text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
                <span className={cn("tabular-nums", active ? "text-background/70" : "text-muted-foreground/80")}>
                  {counts[option.value]}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="overflow-hidden rounded-lg border">
        {!loaded ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Henter logg …</p>
        ) : visibleRows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            {filter === "kjoring" || (!hasTimeforing && hasKjorebok)
              ? "Ingen kjøreturer på dette prosjektet ennå."
              : filter === "timer" || !hasKjorebok
                ? "Ingen timer ført ennå. Stemple inn eller før timer manuelt fra Registrer-menyen."
                : "Ingen timer eller kjøreturer ennå."}
          </p>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Dato</th>
                  {both && <th className="px-4 py-2 text-left font-medium">Type</th>}
                  <th className="px-4 py-2 text-left font-medium">Hva</th>
                  {showPerson && <th className="px-4 py-2 text-left font-medium">Person</th>}
                  <th className="px-4 py-2 text-right font-medium">Mengde</th>
                  {hasKjorebok && <th className="px-4 py-2 text-right font-medium">Beløp</th>}
                  <th className="w-20 px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) =>
                  row.kind === "timer" ? (
                    <tr key={`t-${row.id}`} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-2">{dayLabel(row.entry.entry_date)}</td>
                      {both && (
                        <td className="px-4 py-2">
                          <KindBadge kind="timer" />
                        </td>
                      )}
                      <td className="px-4 py-2">
                        <span className="line-clamp-1">
                          {[timeRange(row.entry), row.entry.description].filter(Boolean).join(" · ") || "—"}
                        </span>
                      </td>
                      {showPerson && (
                        <td className="px-4 py-2">
                          {(() => {
                            const user = unwrapRelation(row.entry.users)
                            return user?.full_name || user?.email || (row.entry.user_id === currentUserId ? "Deg" : "Ukjent")
                          })()}
                        </td>
                      )}
                      <td className="px-4 py-2 text-right font-medium tabular-nums">{formatHours(row.entry.hours)}</td>
                      {hasKjorebok && <td className="px-4 py-2 text-right text-muted-foreground">—</td>}
                      <td className="px-4 py-2" />
                    </tr>
                  ) : (
                    <tr key={`k-${row.id}`} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-2">{dayLabel(row.trip.trip_date)}</td>
                      {both && (
                        <td className="px-4 py-2">
                          <KindBadge kind="kjoring" privat={row.trip.classification === "private"} />
                        </td>
                      )}
                      <td className="px-4 py-2">
                        <span className="line-clamp-1">{tripRoute(row.trip)}</span>
                      </td>
                      {showPerson && <td className="px-4 py-2">{row.trip.driver_name || "Ukjent"}</td>}
                      <td className="px-4 py-2 text-right font-medium tabular-nums">{km(Number(row.trip.distance_km))}</td>
                      <td className="px-4 py-2 text-right tabular-nums">
                        {kr(Number(row.trip.amount_nok))}
                        {Number(row.trip.fuel_cost_nok) > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            Drivstoff {kr(Number(row.trip.fuel_cost_nok))}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => openTrip(row.trip)} aria-label="Rediger tur">
                            <Pencil className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="size-8" onClick={() => void onDeleteTrip(row.trip)} aria-label="Slett tur">
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>

            <ul className="divide-y md:hidden">
              {visibleRows.map((row) =>
                row.kind === "timer" ? (
                  <li key={`t-${row.id}`} className="flex items-start gap-3 px-4 py-3">
                    <KindIcon kind="timer" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium tabular-nums">{formatHours(row.entry.hours)}</p>
                      <p className="text-sm text-muted-foreground">
                        {dayLabel(row.entry.entry_date)}
                        {timeRange(row.entry) ? ` · ${timeRange(row.entry)}` : ""}
                      </p>
                      {showPerson && (
                        <p className="text-xs text-muted-foreground">
                          {unwrapRelation(row.entry.users)?.full_name || "Ukjent"}
                        </p>
                      )}
                      {row.entry.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{row.entry.description}</p>
                      )}
                    </div>
                  </li>
                ) : (
                  <li key={`k-${row.id}`} className="flex items-start gap-3 px-4 py-3">
                    <KindIcon kind="kjoring" />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => openTrip(row.trip)}>
                      <p className="font-medium tabular-nums">
                        {km(Number(row.trip.distance_km))} · {kr(Number(row.trip.amount_nok))}
                        {row.trip.classification === "private" && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">Privat</span>
                        )}
                      </p>
                      <p className="line-clamp-1 text-sm text-muted-foreground">{tripRoute(row.trip)}</p>
                      <p className="text-xs text-muted-foreground">
                        {dayLabel(row.trip.trip_date)}
                        {showPerson && row.trip.driver_name ? ` · ${row.trip.driver_name}` : ""}
                      </p>
                    </button>
                    <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => void onDeleteTrip(row.trip)} aria-label="Slett tur">
                      <Trash2 className="size-4 text-destructive" />
                    </Button>
                  </li>
                )
              )}
            </ul>
          </>
        )}
      </div>

      {!hasTimeforing && (
        <ModuleGate
          moduleName="Timeføring"
          monthlyPriceNok={MODULE_PRICING.timeforing}
          description="Registrer og følg arbeidstimer direkte på prosjektet."
        />
      )}
      {!hasKjorebok && (
        <ModuleGate
          moduleName="Kjørebok"
          monthlyPriceNok={MODULE_PRICING.kjorebok}
          description="Før kjørebok med GPS eller manuelt — statens satser og Tripletex-eksport, direkte på prosjektet."
        />
      )}

      {hasKjorebok && (
        <>
          <TripFormDialog
            open={formOpen}
            onOpenChange={setFormOpen}
            projects={overview.projects}
            drivers={overview.drivers}
            vehicles={overview.vehicles}
            canViewAll={canViewAllTrips}
            currentUserId={currentUserId}
            defaultProjectId={projectId}
            editingTrip={editingTrip}
            onSaved={() => {
              toast.success("Kjøretur lagret")
              void loadTrips()
            }}
          />
          <DriveTrackerDialog projectId={projectId} open={trackerOpen} onOpenChange={setTrackerOpen} />
        </>
      )}
    </div>
  )
}

function KindBadge({ kind, privat = false }: { kind: "timer" | "kjoring"; privat?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
        kind === "timer" ? "bg-muted/60 text-foreground/80" : "bg-[color:var(--overlay-info)] text-[color:var(--tone-info-strong)]"
      )}
    >
      {kind === "timer" ? <Clock className="size-3" /> : <Navigation className="size-3" />}
      {kind === "timer" ? "Timer" : privat ? "Privat tur" : "Kjøring"}
    </span>
  )
}

function KindIcon({ kind }: { kind: "timer" | "kjoring" }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border",
        kind === "timer" ? "bg-muted/60" : "bg-[color:var(--overlay-info)] text-[color:var(--tone-info-strong)]"
      )}
    >
      {kind === "timer" ? <Clock className="size-4" /> : <Navigation className="size-4" />}
    </span>
  )
}
