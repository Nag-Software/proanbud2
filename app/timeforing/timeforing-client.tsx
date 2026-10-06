"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import {
  CheckCircle2,
  Circle,
  Clock,
  FolderPlus,
  Loader2,
  MapPin,
  Pencil,
  Play,
  Square,
  UserRound,
} from "lucide-react"
import { toast } from "sonner"

import {
  StickyActionBar,
  StickyActionBarSpacer,
} from "@/components/mobile/sticky-action-bar"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchableSelect } from "@/components/ui/searchable-select"
import { Textarea } from "@/components/ui/textarea"
import {
  addManualTimeEntryAction,
  geofenceCheckInAction,
  getMyTimeTrackingOverviewAction,
  startWorkSessionAction,
  stopWorkSessionAction,
  type ActionResult,
  type MyTimeTrackingOverview,
} from "@/app/timeforing/actions"
import { track } from "@/lib/analytics/track"
import { entryDateToDay } from "@/lib/time-tracking"
import { WORK_SESSION_CHANGED_EVENT } from "@/hooks/use-active-work-session"
import { reportClientError } from "@/lib/errors/client"
import type { CanonicalRole } from "@/lib/roles"
import { cn } from "@/lib/utils"

/** Vises når selve kallet til serveren feiler (typisk dårlig dekning på plassen). */
const OFFLINE_ERROR_MESSAGE =
  "Fikk ikke kontakt med serveren. Sjekk internettforbindelsen og prøv igjen."

/** Står to steder — i kortet på desktop, i bunnbaren på mobil. */
const GPS_HINT = "Bruker GPS for å bekrefte at du er på byggeplassen."

/** Husker forrige valgte prosjekt så gjentaksvalget er ett trykk. */
const LAST_PROJECT_KEY = "proanbud.timeforing.sist-valgte-prosjekt"

/**
 * Med flere prosjekter enn dette bytter velgeren fra kort til nedtrekksliste.
 *
 * Sto på 6. Seks kort à 56 px er 340 px, og på en telefon dyttet det
 * «Stemple inn på plassen» under folden — altså var sidens hele formål
 * usynlig når du åpnet den. Tre kort er fortsatt ett trykk for den som har
 * få prosjekter, og over det er nedtrekkslista både kortere og raskere.
 */
const MAX_PROJECT_CARDS = 3

/** Gi beskjed til nav-indikatorene (sidebar/bunn-nav) om at stemplingsstatus endret seg. */
function notifyWorkSessionChanged() {
  window.dispatchEvent(new Event(WORK_SESSION_CHANGED_EVENT))
}

function pad2(value: number) {
  return String(value).padStart(2, "0")
}

function todayLocalISODate() {
  const now = new Date()
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
}

/** Build a Date in the browser's local timezone from a `YYYY-MM-DD` date and `HH:mm` time. */
function buildLocalDateTime(dateStr: string, timeStr: string): Date | null {
  const dateParts = dateStr.split("-").map(Number)
  const timeParts = timeStr.split(":").map(Number)
  if (dateParts.length !== 3 || timeParts.length < 2) return null

  const [year, month, day] = dateParts
  const [hour, minute] = timeParts
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null

  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

/** «7,5 t» — norsk desimalkomma, maks to desimaler. */
function formatT(hours: number) {
  return `${(Math.round(hours * 100) / 100).toLocaleString("nb-NO", { maximumFractionDigits: 2 })} t`
}

/** «3,5 timer» / «1 time» — til toasts og bekreftelser. */
function formatTimerHuman(hours: number) {
  const rounded = Math.round(hours * 100) / 100
  const text = rounded.toLocaleString("nb-NO", { maximumFractionDigits: 2 })
  return `${text} ${rounded === 1 ? "time" : "timer"}`
}

/** Medgått tid som «2 t 08 min» — oppdateres hvert halvminutt. */
function formatElapsed(startedAt: string, nowMs: number) {
  const totalMinutes = Math.max(0, Math.floor((nowMs - new Date(startedAt).getTime()) / 60_000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours} t ${pad2(minutes)} min` : `${minutes} min`
}

type TimeforingClientProps = {
  role: CanonicalRole | null
  initial: ActionResult<MyTimeTrackingOverview>
}

export function TimeforingClient({ role, initial }: TimeforingClientProps) {
  const [overview, setOverview] = useState<MyTimeTrackingOverview | null>(
    initial.ok ? initial.data : null
  )
  const [loadError, setLoadError] = useState<string | null>(initial.ok ? null : initial.error)

  // Ny rendering fra serveren (router.refresh() når du kommer tilbake til
  // fanen, eller etter en endring) — ta imot de ferske dataene.
  useEffect(() => {
    if (!initial.ok) return
    setOverview(initial.data)
    setLoadError(null)
  }, [initial])
  const [retrying, setRetrying] = useState(false)

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checkingIn, setCheckingIn] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [elapsedLabel, setElapsedLabel] = useState("0 min")

  const [showManual, setShowManual] = useState(false)
  const [manualProjectId, setManualProjectId] = useState("")
  const [manualDate, setManualDate] = useState("")
  const [manualFrom, setManualFrom] = useState("07:00")
  const [manualTo, setManualTo] = useState("15:00")
  const [manualNote, setManualNote] = useState("")
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualSubmitting, setManualSubmitting] = useState(false)
  const [manualDrawerOpen, setManualDrawerOpen] = useState(false)

  const activeSession = overview?.activeSession ?? null
  const projects = overview?.projects ?? []
  const recentEntries = overview?.recentEntries ?? []
  const weekHours = overview?.weekHours ?? 0

  // Navnet står i lista, adressen ligger bak som søkeord: du finner plassen
  // enten du husker hva prosjektet heter eller hvor du kjørte.
  const projectOptions = useMemo(
    () =>
      (overview?.projects ?? []).map((project) => ({
        value: project.id,
        label: project.name,
        keywords: project.site_address ?? "",
      })),
    [overview?.projects]
  )

  const refresh = useCallback(async () => {
    try {
      const result = await getMyTimeTrackingOverviewAction()
      if (result.ok) {
        setOverview(result.data)
        setLoadError(null)
      } else {
        setLoadError(result.error)
      }
    } catch (refreshError) {
      reportClientError(refreshError, { context: { action: "hente timeoversikt" } })
      setLoadError(OFFLINE_ERROR_MESSAGE)
    }
  }, [])

  // Forhåndsvelg prosjekt: forrige valg fra localStorage, ellers eneste prosjekt.
  useEffect(() => {
    if (!overview) return
    setSelectedProjectId((prev) => {
      if (prev && overview.projects.some((p) => p.id === prev)) return prev
      let stored: string | null = null
      try {
        stored = window.localStorage.getItem(LAST_PROJECT_KEY)
      } catch {
        // localStorage kan være utilgjengelig (privat modus) — da husker vi bare ikke valget.
      }
      if (stored && overview.projects.some((p) => p.id === stored)) return stored
      if (overview.projects.length === 1) return overview.projects[0].id
      return prev
    })
  }, [overview])

  // Levende medgått tid mens en økt pågår.
  useEffect(() => {
    if (!activeSession?.started_at) {
      setElapsedLabel("0 min")
      return
    }
    const update = () => setElapsedLabel(formatElapsed(activeSession.started_at, Date.now()))
    update()
    const interval = window.setInterval(update, 30_000)
    return () => window.clearInterval(interval)
  }, [activeSession?.started_at])

  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId)
    try {
      window.localStorage.setItem(LAST_PROJECT_KEY, projectId)
    } catch {
      // Ikke kritisk — valget huskes bare ikke til neste gang.
    }
  }, [])

  function handleGeofenceCheckIn() {
    if (!selectedProjectId) return
    setError(null)
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Enheten støtter ikke posisjon")
      return
    }
    setCheckingIn(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude, accuracy } = pos.coords
          const result = await geofenceCheckInAction(selectedProjectId, latitude, longitude, accuracy)
          if (!result.ok) {
            setError(result.error)
            // Kan skyldes en aktiv økt startet på en annen enhet — hent fersk status.
            void refresh()
            return
          }
          const projectName =
            projects.find((p) => p.id === selectedProjectId)?.name || "prosjektet"
          setOverview((prev) =>
            prev ? { ...prev, activeSession: { ...result.data, projectName } } : prev
          )
          notifyWorkSessionChanged()
          track("stemplet_inn", { metode: "gps" })
        } catch (checkInError) {
          reportClientError(checkInError, {
            context: { action: "stemple inn (geofence)", projectId: selectedProjectId },
          })
          setError(OFFLINE_ERROR_MESSAGE)
        } finally {
          setCheckingIn(false)
        }
      },
      () => {
        setError("Fikk ikke posisjon. Slå på stedstjenester og prøv igjen.")
        setCheckingIn(false)
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    )
  }

  async function handleStartWithoutGps() {
    if (!selectedProjectId) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await startWorkSessionAction(selectedProjectId)
      if (!result.ok) {
        setError(result.error)
        void refresh()
        return
      }
      const projectName = projects.find((p) => p.id === selectedProjectId)?.name || "prosjektet"
      setOverview((prev) =>
        prev ? { ...prev, activeSession: { ...result.data, projectName } } : prev
      )
      notifyWorkSessionChanged()
      track("stemplet_inn", { metode: "uten_gps" })
    } catch (startError) {
      reportClientError(startError, {
        context: { action: "starte arbeidsøkt", projectId: selectedProjectId },
      })
      setError(OFFLINE_ERROR_MESSAGE)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleStopp() {
    if (!activeSession) return
    setError(null)
    setIsSubmitting(true)
    try {
      const result = await stopWorkSessionAction(activeSession.project_id)
      if (!result.ok) {
        setError(result.error)
        void refresh()
        return
      }
      toast.success(
        `Økt lagret: ${formatTimerHuman(Number(result.data.hours || 0))} på ${activeSession.projectName}`
      )
      setOverview((prev) => (prev ? { ...prev, activeSession: null } : prev))
      notifyWorkSessionChanged()
      track("stemplet_ut")
      await refresh()
    } catch (stopError) {
      reportClientError(stopError, {
        context: { action: "avslutte arbeidsøkt", projectId: activeSession.project_id },
      })
      setError(OFFLINE_ERROR_MESSAGE)
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleToggleManual() {
    setManualError(null)
    setShowManual((open) => {
      const next = !open
      if (next) {
        if (!manualDate) setManualDate(todayLocalISODate())
        if (!manualProjectId && selectedProjectId) setManualProjectId(selectedProjectId)
      }
      return next
    })
  }

  // Mobil: skjemaet bor i en skuff fra bunnen, åpnet fra knappen under
  // «Stemple inn på plassen» i den faste baren. Samme skjema som i kortet.
  function openManualDrawer() {
    setManualError(null)
    if (!manualDate) setManualDate(todayLocalISODate())
    if (!manualProjectId && selectedProjectId) setManualProjectId(selectedProjectId)
    setManualDrawerOpen(true)
  }

  async function handleSaveManual() {
    setManualError(null)

    if (!manualProjectId) {
      setManualError("Velg hvilket prosjekt timene gjelder")
      return
    }

    const start = buildLocalDateTime(manualDate, manualFrom)
    const end = buildLocalDateTime(manualDate, manualTo)
    if (!start || !end) {
      setManualError("Fyll inn dato, fra og til")
      return
    }

    const diffHours = (end.getTime() - start.getTime()) / 3_600_000
    if (diffHours <= 0) {
      setManualError("Sluttid må være etter starttid")
      return
    }
    if (diffHours > 24) {
      setManualError("En arbeidsøkt kan ikke være lengre enn 24 timer")
      return
    }

    setManualSubmitting(true)
    try {
      const result = await addManualTimeEntryAction(manualProjectId, {
        entryDate: manualDate,
        startedAt: start.toISOString(),
        endedAt: end.toISOString(),
        description: manualNote,
      })
      if (!result.ok) {
        setManualError(result.error)
        return
      }
      const projectName = projects.find((p) => p.id === manualProjectId)?.name || "prosjektet"
      toast.success(
        `Timer lagret: ${formatTimerHuman(Number(result.data.hours || 0))} på ${projectName}`
      )
      setManualNote("")
      setShowManual(false)
      setManualDrawerOpen(false)
      await refresh()
    } catch (saveError) {
      reportClientError(saveError, {
        context: { action: "lagre manuell timeføring", projectId: manualProjectId },
      })
      setManualError(OFFLINE_ERROR_MESSAGE)
    } finally {
      setManualSubmitting(false)
    }
  }

  // ── Spesialtilstander ───────────────────────────────────────────────────────

  if (loadError === "MODULE_MISSING") {
    return <ModuleMissingState role={role} />
  }

  if (!overview) {
    return (
      <div className="mx-auto w-full max-w-2xl pt-6">
        <Card>
          <CardHeader>
            <CardTitle>Kunne ikke hente timeføringen</CardTitle>
            <CardDescription>{loadError || OFFLINE_ERROR_MESSAGE}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              type="button"
              className="gap-2"
              disabled={retrying}
              onClick={async () => {
                setRetrying(true)
                await refresh()
                setRetrying(false)
              }}
            >
              {retrying && <Loader2 className="size-4 animate-spin" />}
              Prøv igjen
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const manualStart = manualDate ? buildLocalDateTime(manualDate, manualFrom) : null
  const manualEnd = manualDate ? buildLocalDateTime(manualDate, manualTo) : null
  const manualHours =
    manualStart && manualEnd ? (manualEnd.getTime() - manualStart.getTime()) / 3_600_000 : null

  const startedAtDate = activeSession ? new Date(activeSession.started_at) : null
  const startedToday = startedAtDate
    ? format(startedAtDate, "yyyy-MM-dd") === todayLocalISODate()
    : true

  /**
   * Sidens hele formål. Rendres to steder som utelukker hverandre: inne i
   * kortet fra md og opp, og i den faste bunnbaren på mobil — aldri begge
   * samtidig, så det finnes fortsatt bare én «stemple inn»-knapp på skjermen.
   */
  const checkInButton = (
    <Button
      size="xl"
      type="button"
      className="w-full gap-2 text-base font-semibold md:h-[var(--control-h-lg)] md:text-sm"
      onClick={handleGeofenceCheckIn}
      disabled={!selectedProjectId || isSubmitting || checkingIn}
    >
      {checkingIn ? (
        <Loader2 className="size-5 animate-spin md:size-4" />
      ) : (
        <MapPin className="size-5 md:size-4" />
      )}
      {checkingIn ? "Henter posisjon …" : "Stemple inn på plassen"}
    </Button>
  )

  const showStickyCheckIn = !activeSession && projects.length > 0

  // Ett skjema, to hjem: utslått i kortet (desktop, og mobil uten fast bar),
  // i en skuff fra bunnen når den faste baren er der. Aldri begge samtidig,
  // så id-ene kolliderer ikke.
  const manualForm = (
    <div className="mt-4 space-y-3 md:mt-3">
      <div className="space-y-2 md:space-y-1.5">
        <Label htmlFor="manual-project">Prosjekt</Label>
        <SearchableSelect
          id="manual-project"
          value={manualProjectId}
          onChange={setManualProjectId}
          options={projectOptions}
          placeholder="Velg prosjekt"
          searchPlaceholder="Søk på prosjekt eller adresse …"
          emptyText="Ingen prosjekter passer søket"
          className="h-10 w-full md:h-9"
        />
      </div>

      {/* Desktop: dato, fra og til på én linje. Mobil: dato over, tidene side om side. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_7rem_7rem]">
        <div className="col-span-2 space-y-2 md:col-span-1 md:space-y-1.5">
          <Label htmlFor="manual-date">Dato</Label>
          <DatePicker
            id="manual-date"
            value={manualDate}
            maxDate={todayLocalISODate()}
            onChange={setManualDate}
            className="h-10 w-full md:h-9"
          />
        </div>
        <div className="space-y-2 md:space-y-1.5">
          <Label htmlFor="manual-from">Fra</Label>
          <Input
            id="manual-from"
            type="time"
            value={manualFrom}
            onChange={(event) => setManualFrom(event.target.value)}
          />
        </div>
        <div className="space-y-2 md:space-y-1.5">
          <Label htmlFor="manual-to">Til</Label>
          <Input
            id="manual-to"
            type="time"
            value={manualTo}
            onChange={(event) => setManualTo(event.target.value)}
          />
        </div>
      </div>

      <div className="space-y-2 md:space-y-1.5">
        <Label htmlFor="manual-note">Notat (valgfritt)</Label>
        <Textarea
          id="manual-note"
          value={manualNote}
          onChange={(event) => setManualNote(event.target.value)}
          placeholder="Hva jobbet du med?"
          rows={2}
        />
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm md:py-1.5 md:text-[13px]">
        {manualHours && manualHours > 0 ? (
          <span>
            Beregnet: <span className="font-semibold">{formatT(manualHours)}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Velg gyldig tidsrom for å beregne timer</span>
        )}
      </div>

      {manualError && <p className="text-sm text-destructive">{manualError}</p>}

      <Button
        size="lg"
        type="button"
        className="w-full md:h-[var(--control-h)]"
        onClick={handleSaveManual}
        disabled={manualSubmitting}
      >
        {manualSubmitting ? "Lagrer …" : "Lagre timeføring"}
      </Button>
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 pb-8 md:max-w-xl md:space-y-3">
      <div className="space-y-0.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground md:text-xl">
          Timeføring
        </h1>
        {/* Kun desktop: på mobil stjeler linja høyde fra selve stemplingen. */}
        <p className="hidden text-[13px] text-muted-foreground md:block">
          Stemple inn når du starter — timene lagres når du stempler ut.
        </p>
      </div>

      {activeSession ? (
        <div className="rounded-xl border border-green-200 bg-green-50 p-5 md:p-4 dark:border-green-900/60 dark:bg-green-950/30">
          <div className="flex items-center gap-2.5">
            <span className="relative flex size-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
              <span className="relative inline-flex size-3 rounded-full bg-green-600" />
            </span>
            <p className="font-semibold text-green-900 md:text-sm dark:text-green-100">
              Du er stemplet inn
            </p>
          </div>

          <p className="mt-4 text-lg font-semibold text-foreground md:mt-3 md:text-base">
            {activeSession.projectName}
          </p>
          <p className="text-sm text-green-900/70 md:text-[13px] dark:text-green-200/70">
            Startet{" "}
            {startedToday
              ? `kl. ${format(startedAtDate!, "HH:mm")}`
              : format(startedAtDate!, "d. MMM 'kl.' HH:mm", { locale: nb })}
          </p>

          <p className="mt-4 text-4xl font-semibold tabular-nums text-green-900 md:mt-3 md:text-3xl dark:text-green-50">
            {elapsedLabel}
          </p>

          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

          <Button size="xl"
            type="button"
            variant="destructive"
            className="mt-5 w-full gap-2 text-base font-semibold md:mt-4 md:h-[var(--control-h-lg)] md:text-sm"
            onClick={handleStopp}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="size-5 animate-spin md:size-4" />
            ) : (
              <Square className="size-5 md:size-4" />
            )}
            Stemple ut
          </Button>
        </div>
      ) : projects.length === 0 ? (
        <NoProjectsState role={role} />
      ) : (
        <div className="space-y-4 rounded-xl border p-5 md:space-y-3 md:p-4">
          <div>
            <h2 className="font-semibold md:text-sm">Hvilket prosjekt jobber du på?</h2>
            <p className="text-sm text-muted-foreground md:text-[13px]">
              Velg prosjekt og stemple inn — vi husker valget til neste gang.
            </p>
          </div>

          {projects.length <= MAX_PROJECT_CARDS ? (
            <div className="grid gap-2 md:gap-1.5">
              {projects.map((project) => {
                const selected = project.id === selectedProjectId
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => selectProject(project.id)}
                    aria-pressed={selected}
                    className={cn(
                      "flex min-h-12 items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-base font-medium transition-colors md:min-h-9 md:px-3 md:py-1.5 md:text-sm",
                      selected
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <span className="min-w-0 truncate">{project.name}</span>
                    {selected ? (
                      <CheckCircle2 className="size-5 shrink-0 text-primary md:size-4" />
                    ) : (
                      <Circle className="size-5 shrink-0 text-muted-foreground/40 md:size-4" />
                    )}
                  </button>
                )
              })}
            </div>
          ) : (
            // Med mange prosjekter er rulling gjennom en liste det tregeste
            // man kan gjøre med hansker på. SearchableSelect søker på både
            // navn og byggeplassadresse — samme komponent som turskjemaet i
            // kjøreboka bruker.
            <SearchableSelect
              value={selectedProjectId ?? ""}
              onChange={selectProject}
              options={projectOptions}
              placeholder="Velg prosjekt"
              searchPlaceholder="Søk på prosjekt eller adresse …"
              emptyText="Ingen prosjekter passer søket"
              className="h-12 w-full text-base md:h-9 md:text-sm"
            />
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* På mobil bor både knappen og forklaringen i den faste baren
              nederst (se lenger ned). Blir forklaringen stående igjen her,
              leses den som en beskrivelse av «Start uten GPS» — altså det
              motsatte av hva den sier. */}
          <div className="hidden space-y-1 md:block">
            {checkInButton}
            <p className="text-xs text-muted-foreground">{GPS_HINT}</p>
          </div>

          <Button size="lg"
            type="button"
            variant="outline"
            className="w-full gap-2 md:h-[var(--control-h)]"
            onClick={handleStartWithoutGps}
            disabled={!selectedProjectId || isSubmitting || checkingIn}
          >
            {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            Start uten GPS
          </Button>
        </div>
      )}

      {projects.length > 0 && (
        <div
          className={cn(
            "rounded-xl border p-5 md:px-4 md:py-3",
            // Med den faste baren nederst ligger inngangen der (skuffen) —
            // kortet ville bare vært det samme én gang til.
            showStickyCheckIn && "hidden md:block"
          )}
        >
          <button
            type="button"
            onClick={handleToggleManual}
            className="flex w-full items-center gap-2 text-left md:gap-2.5"
          >
            <Pencil className="size-5 text-primary md:size-4" />
            <div>
              <h2 className="font-semibold md:text-sm">Før timer manuelt</h2>
              <p className="text-sm text-muted-foreground md:text-[13px]">
                Glemte du å stemple? Før opp arbeid i ettertid.
              </p>
            </div>
          </button>

          {showManual && manualForm}
        </div>
      )}

      {/* Mobil med fast bar: skjemaet kommer som skuff fra bunnen i stedet. */}
      <Drawer direction="bottom" open={manualDrawerOpen} onOpenChange={setManualDrawerOpen}>
        <DrawerContent className="px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <DrawerHeader className="px-0">
            <DrawerTitle>Før timer manuelt</DrawerTitle>
            <DrawerDescription>Glemte du å stemple? Før opp arbeid i ettertid.</DrawerDescription>
          </DrawerHeader>
          <div className="min-h-0 overflow-y-auto">{manualForm}</div>
        </DrawerContent>
      </Drawer>

      <div className="rounded-xl border">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4 md:px-4 md:py-3">
          <div>
            <h2 className="font-semibold md:text-sm">Denne uka</h2>
            <p className="text-sm text-muted-foreground md:text-[13px]">
              Sum fra mandag · listen viser de siste 7 dagene
            </p>
          </div>
          <p className="shrink-0 whitespace-nowrap text-2xl font-semibold tabular-nums md:text-xl">
            {formatT(weekHours)}
          </p>
        </div>

        {recentEntries.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted-foreground md:px-4 md:py-6 md:text-[13px]">
            Ingen timer registrert de siste 7 dagene ennå.
          </p>
        ) : (
          <div className="divide-y">
            {recentEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center justify-between gap-3 px-5 py-3 md:px-4 md:py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium md:text-sm">{entry.projectName}</p>
                  <p className="text-sm text-muted-foreground md:text-xs">
                    {format(entryDateToDay(entry.entryDate), "EEEE d. MMM", { locale: nb })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-medium tabular-nums md:text-sm">{formatT(entry.hours)}</span>
                  {entry.status === "pending" ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                      Venter
                    </span>
                  ) : entry.status === "rejected" ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:bg-red-900/40 dark:text-red-200">
                      Avvist – snakk med lederen din
                    </span>
                  ) : (
                    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/40 dark:text-green-200">
                      Godkjent
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showStickyCheckIn && (
        <>
          <StickyActionBarSpacer className="h-44" />
          <StickyActionBar>
            {checkInButton}
            <Button
              size="lg"
              type="button"
              variant="outline"
              className="mt-2 w-full gap-2"
              onClick={openManualDrawer}
            >
              <Pencil className="size-4" />
              Før timer manuelt
            </Button>
            <p className="mt-1.5 text-center text-[11px] text-muted-foreground">{GPS_HINT}</p>
          </StickyActionBar>
        </>
      )}
    </div>
  )
}

/** Modulen er ikke aktivert på abonnementet. Admin får lenke til betaling. */
function ModuleMissingState({ role }: { role: CanonicalRole | null }) {
  const isAdmin = role === "admin"
  return (
    <div className="mx-auto w-full max-w-lg pt-6">
      <Card>
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Clock className="size-5 text-primary" />
          </div>
          <CardTitle>Timeføring er ikke aktivert</CardTitle>
          <CardDescription>
            Med Timeføring stempler du inn og ut rett fra mobilen, og timene havner automatisk på
            riktig prosjekt.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isAdmin ? (
            <>
              {/* Kjøpsoppfordring og knapp skjules i appen (App Store 3.1.1). */}
              <p className="native-hide text-sm text-muted-foreground">
                Aktiver Timeføring under Min bedrift → Betaling.
              </p>
              <p className="hidden text-sm text-muted-foreground [html[data-native]_&]:block">
                Timeføring er ikke med i bedriftens abonnement.
              </p>
              <Button asChild className="native-hide">
                <Link href="/innstillinger/betaling">Gå til abonnement</Link>
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Be administratoren din aktivere Timeføring.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** Ingen prosjekter å stemple inn på — samme vennlige tone som på /prosjekter. */
function NoProjectsState({ role }: { role: CanonicalRole | null }) {
  if (role === "worker") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <UserRound className="size-5" />
        </div>
        <p className="mt-1 text-base font-semibold text-foreground">
          Du er ikke lagt til i noen prosjekter ennå
        </p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Be administratoren eller prosjektlederen din om å legge deg til som deltaker — da kan du
          stemple inn her.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FolderPlus className="size-5" />
      </div>
      <p className="mt-1 text-base font-semibold text-foreground">Ingen aktive prosjekter ennå</p>
      <p className="max-w-sm text-sm text-muted-foreground">
        Opprett et prosjekt først — så kan du og laget føre timer på det her.
      </p>
      <Button asChild className="mt-3">
        <Link href="/prosjekter/ny">
          <FolderPlus />
          Opprett prosjekt
        </Link>
      </Button>
    </div>
  )
}
