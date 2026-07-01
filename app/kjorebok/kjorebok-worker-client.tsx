"use client"

import { useCallback, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import {
  FolderKanbanIcon,
  MapPinnedIcon,
  NavigationIcon,
  PencilIcon,
  PlusIcon,
  RouteIcon,
  Trash2Icon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
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
import { useConfirm } from "@/components/ui/confirm-dialog"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { reportClientError } from "@/lib/errors/client"
import { deleteTripAction, getCompanyTripsOverviewAction } from "@/app/kjorebok/actions"
import { TripFormDialog } from "@/components/kjorebok/trip-form-dialog"
import { LiveTracker } from "@/components/kjorebok/live-tracker"
import { getStatensSats } from "@/lib/kjorebok/rates"
import { NEW_TRIP_DRAFT_KEY } from "@/lib/kjorebok/types"
import type { TripClassification, TripFilter, TripsOverview, TripWithRefs } from "@/lib/kjorebok/types"

function kr(n: number) {
  return n.toLocaleString("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 0 })
}
function km(n: number) {
  return `${n.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} km`
}

// Hjelpetekst for godtgjørelse — henter satsen fra samme konstant som beregningen bruker.
const SATS_HINT = `Beregnet etter statens sats (${getStatensSats().baseNokPerKm.toLocaleString("nb-NO", { minimumFractionDigits: 2 })} kr/km)`

const ALL = "__all__"

function StatTile({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="bg-card px-4 py-3.5">
      <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{hint}</p>}
    </div>
  )
}

type Props = {
  initialOverview: TripsOverview
  currentUserId: string
}

/**
 * Samlet kjørebok for håndverkere: egne turer på tvers av alle prosjekter.
 * Lean variant av bedriftsoversikten (/min-bedrift/kjorebok) — uten
 * sjåfør-fane, kjøretøyadministrasjon og Tripletex-handlinger (som uansett
 * er forbeholdt admin/prosjektleder). Serveren avgrenser data til egne turer.
 */
export function KjorebokWorkerClient({ initialOverview, currentUserId }: Props) {
  const confirm = useConfirm()
  const router = useRouter()
  const [overview, setOverview] = useState<TripsOverview>(initialOverview)
  const [filter, setFilter] = useState<TripFilter>({})
  const [, startTransition] = useTransition()
  const [loading, setLoading] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editingTrip, setEditingTrip] = useState<TripWithRefs | null>(null)
  const [trackerOpen, setTrackerOpen] = useState(false)

  const { totals, trips, byProject, drivers, projects, vehicles } = overview

  const refresh = useCallback(
    async (nextFilter?: TripFilter) => {
      setLoading(true)
      try {
        const data = await getCompanyTripsOverviewAction(nextFilter ?? filter)
        setOverview(data)
      } catch (e) {
        reportClientError(e, { context: { action: "oppdatere kjørebok" } })
      } finally {
        setLoading(false)
      }
    },
    [filter]
  )

  function updateFilter(patch: Partial<TripFilter>) {
    const next = { ...filter, ...patch }
    // Drop empty keys so the action treats them as "all".
    ;(Object.keys(next) as (keyof TripFilter)[]).forEach((k) => {
      if (!next[k]) delete next[k]
    })
    setFilter(next)
    startTransition(() => {
      void refresh(next)
    })
  }

  function openNew() {
    router.push("/min-bedrift/kjorebok/ny")
  }
  function openEdit(trip: TripWithRefs) {
    setEditingTrip(trip)
    setFormOpen(true)
  }

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
      void refresh()
    } catch (e) {
      reportClientError(e, { context: { action: "slette kjøretur" } })
      toast.error(e instanceof Error ? e.message : "Kunne ikke slette")
    }
  }

  const stats: Array<{ value: string; label: string; hint?: string }> = [
    { value: km(totals.km), label: "Distanse totalt" },
    { value: kr(totals.amountNok), label: "Godtgjørelse (yrke)", hint: SATS_HINT },
    { value: kr(totals.fuelCostNok), label: "Drivstoff (yrke)" },
    { value: String(totals.tripCount), label: "Turer" },
  ]

  return (
    <>
      <Tabs defaultValue="turer" className="w-full gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <TabsList className="h-9 w-full lg:w-auto">
            <TabsTrigger value="turer" className="gap-1.5">
              <RouteIcon className="size-4" /> Mine turer
            </TabsTrigger>
            <TabsTrigger value="prosjekt" className="gap-1.5">
              <FolderKanbanIcon className="size-4" /> Per prosjekt
            </TabsTrigger>
          </TabsList>

          <div className="flex w-full gap-2 lg:w-auto">
            <Button
              variant="outline"
              className="h-11 flex-1 lg:h-9 lg:flex-initial"
              onClick={() => setTrackerOpen(true)}
            >
              <NavigationIcon className="size-4" /> Start kjøring
            </Button>
            <Button className="h-11 flex-1 lg:h-9 lg:flex-initial" onClick={openNew}>
              <PlusIcon className="size-4" /> Ny tur
            </Button>
          </div>
        </div>

        {/* Stats — følger valgt filter (f.eks. én måned = grunnlaget for lønn) */}
        <div
          className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3 lg:grid-cols-4"
          style={{ borderRadius: 5 }}
        >
          {stats.map((s) => (
            <StatTile key={s.label} value={s.value} label={s.label} hint={s.hint} />
          ))}
        </div>

        {/* Filtre */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            value={filter.month ?? ""}
            onChange={(e) => updateFilter({ month: e.target.value || undefined })}
            className="h-9 w-full sm:w-40"
            aria-label="Filtrer på måned"
          />
          <Select
            value={filter.projectId ?? ALL}
            onValueChange={(v) => updateFilter({ projectId: v === ALL ? undefined : v })}
          >
            <SelectTrigger className="h-9 w-full sm:w-52">
              <SelectValue placeholder="Alle prosjekter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle prosjekter</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filter.classification ?? ALL}
            onValueChange={(v) =>
              updateFilter({ classification: v === ALL ? undefined : (v as TripClassification) })
            }
          >
            <SelectTrigger className="h-9 w-full sm:w-36">
              <SelectValue placeholder="Alle typer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Alle typer</SelectItem>
              <SelectItem value="business">Yrke</SelectItem>
              <SelectItem value="private">Privat</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Mine turer */}
        <TabsContent value="turer" className="space-y-3">
          <div className={cn("hidden border md:block", loading && "opacity-60")} style={{ borderRadius: 8 }}>
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Dato</th>
                  <th className="px-4 py-2.5 text-left font-medium">Strekning</th>
                  <th className="px-4 py-2.5 text-left font-medium">Prosjekt</th>
                  <th className="px-4 py-2.5 text-right font-medium">Km</th>
                  <th className="px-4 py-2.5 text-right font-medium">Beløp</th>
                  <th className="px-4 py-2.5 text-right font-medium">Drivstoff</th>
                  <th className="px-4 py-2.5 text-left font-medium">Type</th>
                  <th className="px-4 py-2.5 text-right font-medium">Handlinger</th>
                </tr>
              </thead>
              <tbody>
                {trips.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      Ingen kjøreturer ennå. Trykk «Ny tur» for å registrere den første.
                    </td>
                  </tr>
                ) : (
                  trips.map((t) => (
                    <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2.5">
                        {format(new Date(t.trip_date), "d. MMM yyyy", { locale: nb })}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="line-clamp-1">
                          {t.from_address || "—"} {t.to_address ? `→ ${t.to_address}` : ""}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">{t.project_name || "—"}</td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                        {Number(t.distance_km).toLocaleString("nb-NO", { maximumFractionDigits: 1 })}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                        {t.classification === "private" ? (
                          <span className="text-muted-foreground">{kr(Number(t.amount_nok))}</span>
                        ) : (
                          kr(Number(t.amount_nok))
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {Number(t.fuel_cost_nok) > 0 ? kr(Number(t.fuel_cost_nok)) : "—"}
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge variant={t.classification === "private" ? "outline" : "secondary"}>
                          {t.classification === "private" ? "Privat" : "Yrke"}
                        </Badge>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" title="Rediger" onClick={() => openEdit(t)}>
                            <PencilIcon className="size-4" />
                          </Button>
                          <Button variant="ghost" size="icon" title="Slett" onClick={() => onDelete(t)}>
                            <Trash2Icon className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className={cn("divide-y overflow-hidden rounded-xl border md:hidden", loading && "opacity-60")}>
            {trips.length === 0 ? (
              <div className="px-4 py-12 text-center text-muted-foreground">
                Ingen kjøreturer ennå. Trykk «Ny tur» for å registrere den første.
              </div>
            ) : (
              trips.map((t) => (
                <div key={t.id} className="px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium">
                      {km(Number(t.distance_km))} · {kr(Number(t.amount_nok))}
                    </p>
                    <Badge variant={t.classification === "private" ? "outline" : "secondary"}>
                      {t.classification === "private" ? "Privat" : "Yrke"}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {t.from_address || "—"} {t.to_address ? `→ ${t.to_address}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {format(new Date(t.trip_date), "d. MMM yyyy", { locale: nb })}
                    {Number(t.fuel_cost_nok) > 0 ? ` · ⛽ ${kr(Number(t.fuel_cost_nok))}` : ""}
                    {t.project_name ? ` · ${t.project_name}` : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => openEdit(t)}>
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
        </TabsContent>

        {/* Per prosjekt */}
        <TabsContent value="prosjekt" className="space-y-3">
          {byProject.length === 0 ? (
            <div className="rounded-xl border px-4 py-10 text-center text-sm text-muted-foreground">
              Ingen turer ennå.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {byProject.map((p) => (
                <div key={p.projectId ?? "none"} className="rounded-xl border bg-card p-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium">{p.projectName ?? "Uten prosjekt"}</p>
                    <p className="text-lg font-semibold tabular-nums">{kr(p.amountNok)}</p>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{km(p.km)}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <TripFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        projects={projects}
        drivers={drivers}
        vehicles={vehicles}
        canViewAll={false}
        currentUserId={currentUserId}
        editingTrip={editingTrip}
        onSaved={() => {
          toast.success("Kjøretur lagret")
          void refresh()
        }}
      />

      <ResponsiveDialog open={trackerOpen} onOpenChange={setTrackerOpen}>
        <ResponsiveDialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <ResponsiveDialogHeader className="px-4 sm:px-0">
            <ResponsiveDialogTitle className="flex items-center gap-2">
              <MapPinnedIcon className="size-5" /> Live kjøring
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Sporer ruten mens du kjører. Du fyller inn detaljer når du stopper.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="px-4 pb-4 sm:px-0">
            <LiveTracker
              onCancel={() => setTrackerOpen(false)}
              onComplete={(draft) => {
                setTrackerOpen(false)
                try {
                  sessionStorage.setItem(NEW_TRIP_DRAFT_KEY, JSON.stringify(draft))
                } catch {
                  /* storage blocked — the page just starts empty */
                }
                router.push("/min-bedrift/kjorebok/ny")
              }}
            />
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  )
}
