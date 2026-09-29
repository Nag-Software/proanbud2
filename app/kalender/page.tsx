"use client";

import { AppPageShell } from "@/components/app-page-shell"
import { Button } from "@/components/ui/button"
import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import { endOfDay, format, startOfDay } from "date-fns"
import { nb } from "date-fns/locale"
import { Plus } from "lucide-react"
import { useAuth } from "@/components/auth-provider"
import {
  CALENDAR_KEYS,
  CALENDAR_MOUNT_MAX_AGE_MS,
  calendarRangeFor,
  CalendarFetchError,
  fetchCalendarEvents,
  fetchCalendarIntegrations,
  fetchCalendarProjects,
  type CalendarRange,
  type RawCalendarEvent,
} from "@/lib/calendar/client-data"
import { fetchPrefetched, readPrefetched } from "@/lib/perf/prefetch-cache"
import { LOGIN_PATH } from '@/lib/constants'
import { toast } from "sonner"
import { reportClientError } from "@/lib/errors/client"
import { useConfirm } from "@/components/ui/confirm-dialog"

import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { Input } from "@/components/ui/input"
import { DateTimeField } from "@/components/ui/date-time-field"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"

import { CalendarToolbar, type CalendarSource, type CalendarView } from "./calendar-toolbar"
import { MonthCalendar } from "./month-calendar"
import type { CalendarEvent } from "./types"
import { useIsMobile } from "@/hooks/use-mobile"
import { useUserRole } from "@/hooks/use-user-role"
import { PlanGate } from "@/components/billing/plan-gate"

// react-big-calendar + drag-and-drop addon + its localizer are the app's
// heaviest chunk and are only needed in week/day view (default is month, which
// renders via the lightweight date-fns MonthCalendar). Load them on demand.
const DnDCalendar = dynamic(() => import("./dnd-calendar"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      Laster kalender…
    </div>
  ),
})

function toCalendarEvents(raw: RawCalendarEvent[]): CalendarEvent[] {
  return raw.map((e) => ({
    ...(e as unknown as CalendarEvent),
    start: new Date(e.start),
    end: new Date(e.end),
    extendedProps: {
      description: e.description,
      projectId: e.projectId,
    },
  }))
}

function defaultSlotTimes(day: Date) {
  const start = new Date(day)
  start.setHours(9, 0, 0, 0)
  const end = new Date(day)
  end.setHours(10, 0, 0, 0)
  return { start, end }
}

function KalenderPage() {
  const isMobile = useIsMobile()
  const confirm = useConfirm()
  const { loadingRole, hasFeature } = useUserRole()
  // Innloggingen leses fra den lokale sesjonen (ingen rundtur til Supabase
  // Auth) — middleware har allerede sluppet brukeren inn på siden.
  const { user: authUser, loading: authLoading } = useAuth()
  const userId: string | null = authUser?.id ?? null
  // Forvarmet av app-skallet (lib/perf/page-data-warmers): det som ligger i
  // cachen vises med en gang, og friskes opp i bakgrunnen.
  const [integrations, setIntegrations] = useState<{ provider: string }[]>(
    () => (userId ? readPrefetched<{ provider: string }[]>(CALENDAR_KEYS.integrations(userId)) : undefined) ?? []
  )
  const [projects, setProjects] = useState<{ id: string; name: string }[]>(
    () => readPrefetched<{ id: string; name: string }[]>(CALENDAR_KEYS.projects) ?? []
  )
  const [loggedIn, setLoggedIn] = useState(() => userId !== null)
  const [isLoading, setIsLoading] = useState(
    () => !userId || readPrefetched(CALENDAR_KEYS.integrations(userId)) === undefined
  )

  const [view, setView] = useState<CalendarView>("month")
  const [date, setDate] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>(() =>
    toCalendarEvents(readPrefetched<RawCalendarEvent[]>(CALENDAR_KEYS.events(calendarRangeFor(new Date()))) ?? [])
  )
  const [fetchRange, setFetchRange] = useState<CalendarRange | null>(null)

  const [timeRange, setTimeRange] = useState<"work" | "full">("work")
  const [visibleProvider, setVisibleProvider] = useState<CalendarSource>("all")

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  /** Import-valget i påkoblingsfasen: kopier Proanbud-avtaler til nytilkoblet kalender. */
  const [importPromptProvider, setImportPromptProvider] = useState<"google" | "microsoft" | null>(null)
  const [isImporting, setIsImporting] = useState(false)
  /** Mobil: dagen brukeren trykket på — åpner dagsarket med avtaler + «Ny avtale». */
  const [daySheetDate, setDaySheetDate] = useState<Date | null>(null)

  const [activeEventId, setActiveEventId] = useState<string | null>(null)
  const [activeEventProvider, setActiveEventProvider] = useState<string | null>(null)
  const [eventTitle, setEventTitle] = useState("")
  const [eventDescription, setEventDescription] = useState("")
  const [eventStart, setEventStart] = useState<Date | null>(null)
  const [eventEnd, setEventEnd] = useState<Date | null>(null)
  const [eventColor, setEventColor] = useState<string>("")
  const [linkedProject, setLinkedProject] = useState<string>("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const searchParams = useSearchParams()

  useEffect(() => {
    if (isMobile && view !== "month") {
      setView("month")
    }
  }, [isMobile, view])

  const minTime = useMemo(() => {
    const d = new Date()
    d.setHours(timeRange === "work" ? 6 : 0, 0, 0, 0)
    return d
  }, [timeRange])

  const maxTime = useMemo(() => {
    const d = new Date()
    d.setHours(timeRange === "work" ? 18 : 23, 59, 59, 999)
    return d
  }, [timeRange])

  // Uten `force` gjenbrukes et svar som er yngre enn CALENDAR_MOUNT_MAX_AGE_MS
  // og et kall som allerede er i gang — det er det som hindrer at samme vindu
  // hentes to ganger når innlogging og tilkoblinger lander hver for seg.
  // Etter en endring (ny/flyttet/slettet avtale) hentes alltid ferskt.
  const fetchEvents = useCallback(async (range: CalendarRange, force = false) => {
    try {
      const raw = await fetchPrefetched(CALENDAR_KEYS.events(range), () => fetchCalendarEvents(range), {
        maxAgeMs: force ? 0 : CALENDAR_MOUNT_MAX_AGE_MS,
        force,
      })
      setEvents(toCalendarEvents(raw))
    } catch (e) {
      if (e instanceof CalendarFetchError) {
        // Tidligere skjedde ingenting – en tom kalender så ut som «ingen avtaler».
        reportClientError(e.message, { level: "warning", context: { action: "Hente kalenderhendelser" } })
        toast.error("Kunne ikke hente avtalene. Last siden på nytt.")
        return
      }
      console.error("Failed to fetch events", e)
      reportClientError(e, { level: "warning", context: { action: "Hente kalenderhendelser" } })
      toast.error("Kunne ikke hente avtalene. Sjekk nettforbindelsen.")
    }
  }, [])

  // Uten argument (etter til-/frakobling): alltid ferskt.
  const loadIntegrations = useCallback(
    async (maxAgeMs = 0) => {
      if (!userId) {
        setLoggedIn(false)
        setIntegrations([])
        setIsLoading(false)
        return
      }
      setLoggedIn(true)
      try {
        setIntegrations(
          await fetchPrefetched(CALENDAR_KEYS.integrations(userId), () => fetchCalendarIntegrations(userId), {
            maxAgeMs,
            force: maxAgeMs === 0,
          })
        )
      } catch (e) {
        reportClientError(e, { level: "warning", context: { action: "Laste kalenderintegrasjoner" } })
        setIntegrations([])
      } finally {
        setIsLoading(false)
      }
    },
    [userId]
  )

  useEffect(() => {
    if (authLoading) return
    loadIntegrations(CALENDAR_MOUNT_MAX_AGE_MS)
  }, [authLoading, loadIntegrations])

  // Prosjektliste til «Koble til prosjekt» — RLS begrenser til brukerens egne prosjekter.
  useEffect(() => {
    if (!loggedIn) return
    fetchPrefetched(CALENDAR_KEYS.projects, fetchCalendarProjects, { maxAgeMs: 60_000 })
      .then(setProjects)
      .catch(() => {
        // Som før: uten prosjektliste kan man fortsatt lage avtaler, bare ikke koble dem.
      })
  }, [loggedIn])

  useEffect(() => {
    const connected = searchParams.get("calendar_connected")
    const error = searchParams.get("calendar_error")

    if (connected === "google") {
      setStatusMessage("Google Calendar er tilkoblet.")
      setImportPromptProvider("google")
      loadIntegrations()
    } else if (connected === "microsoft") {
      setStatusMessage("Outlook Calendar er tilkoblet.")
      setImportPromptProvider("microsoft")
      loadIntegrations()
    } else if (error) {
      setStatusMessage(`Kunne ikke koble til kalender: ${error}`)
    }
  }, [searchParams, loadIntegrations])

  // Hentes uavhengig av tilkoblinger — den innebygde Proanbud-kalenderen
  // finnes alltid; eksterne avtaler kommer i tillegg når noe er koblet til.
  useEffect(() => {
    if (!loggedIn) return
    setFetchRange(calendarRangeFor(date))
  }, [date, view, loggedIn, integrations])

  useEffect(() => {
    if (fetchRange) {
      fetchEvents(fetchRange)
    }
  }, [fetchRange, fetchEvents])

  const triggerRefetch = () => {
     if (fetchRange) {
        fetchEvents(fetchRange, true)
     }
  }

  const handleGoogleAuth = () => {
    if (!loggedIn) {
      window.location.href = LOGIN_PATH
      return
    }
    window.location.href = "/api/auth/google/calendar/start"
  }

  const handleOutlookAuth = () => {
    if (!loggedIn) {
      window.location.href = LOGIN_PATH
      return
    }
    window.location.href = "/api/auth/microsoft/calendar/start"
  }

  const handleImportToProvider = async () => {
    if (!importPromptProvider) return
    const providerName = importPromptProvider === "google" ? "Google" : "Outlook"
    setIsImporting(true)
    try {
      const res = await fetch("/api/calendar/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: importPromptProvider }),
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(
          data.imported > 0
            ? `${data.imported} avtaler ble kopiert til ${providerName}.`
            : `Ingen nye avtaler å kopiere til ${providerName}.`
        )
        setImportPromptProvider(null)
        triggerRefetch()
      } else {
        toast.error(data.error ?? "Kunne ikke kopiere avtalene.")
      }
    } catch (e) {
      reportClientError(e, { context: { action: "Importere kalender til ekstern kalender" } })
      toast.error("Kunne ikke kopiere avtalene.")
    } finally {
      setIsImporting(false)
    }
  }

  const handleDisconnect = async (provider: "google" | "microsoft") => {
    const providerName = provider === "google" ? "Google" : "Outlook"
    const ok = await confirm({
      title: `Koble fra ${providerName} Calendar?`,
      description: `Hendelsene fra ${providerName} Calendar fjernes fra Proanbud-kalenderen, og synkroniseringen stopper. Du kan koble til igjen senere.`,
      confirmText: "Koble fra",
      cancelText: "Avbryt",
      variant: "destructive",
    })
    if (!ok) return
    setIsDisconnecting(true)
    try {
      const res = await fetch(`/api/integrations/calendar/revoke?provider=${provider}`, {
        method: "DELETE",
      })
      if (res.ok) {
        setStatusMessage(`${provider === "google" ? "Google" : "Outlook"} Calendar er frakoblet.`)
        await loadIntegrations()
        // Proanbud-avtalene skal fortsatt vises — hent på nytt i stedet for å tømme.
        triggerRefetch()
      } else {
        const data = await res.json()
        setStatusMessage(data.error ?? "Kunne ikke koble fra kalender.")
      }
    } catch (e) {
      reportClientError(e, { context: { action: "Koble fra kalender", provider } })
      setStatusMessage("Kunne ikke koble fra kalender.")
    } finally {
      setIsDisconnecting(false)
    }
  }

  const filteredEvents = useMemo(() => {
    if (visibleProvider === "all") return events;
    if (visibleProvider === "proanbud") return events.filter(e => e.id.startsWith("local-"));
    if (visibleProvider === "google") return events.filter(e => e.id.startsWith("google-"));
    if (visibleProvider === "microsoft") return events.filter(e => e.id.startsWith("ms-"));
    return events;
  }, [events, visibleProvider]);

  const openCreateDialog = (start: Date, end: Date) => {
    setEventTitle("")
    setEventDescription("")
    setEventStart(start)
    setEventEnd(end)
    setEventColor("")
    setLinkedProject("")
    setIsCreateDialogOpen(true)
  }

  const handleDayClick = (day: Date) => {
    // På mobil er dagcellene små — hele cellen er trefflate og åpner et dagsark
    // med dagens avtaler + «Ny avtale». På desktop åpner dagklikk ny avtale direkte.
    if (isMobile) {
      setDaySheetDate(day)
      return
    }
    const { start, end } = defaultSlotTimes(day)
    openCreateDialog(start, end)
  }

  const daySheetEvents = useMemo(() => {
    if (!daySheetDate) return []
    const dayStart = startOfDay(daySheetDate)
    const dayEnd = endOfDay(daySheetDate)
    return filteredEvents
      .filter((e) => e.start <= dayEnd && (e.end ?? e.start) >= dayStart)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [daySheetDate, filteredEvents])

  // «Ny avtale» fra hurtigarket (/kalender?ny=1) åpner skjemaet direkte.
  const openedFromQueryRef = useRef(false)
  useEffect(() => {
    if (openedFromQueryRef.current || searchParams.get("ny") !== "1") return
    openedFromQueryRef.current = true
    const { start, end } = defaultSlotTimes(new Date())
    openCreateDialog(start, end)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const handleAddEvent = () => {
    const { start, end } = defaultSlotTimes(date)
    openCreateDialog(start, end)
  }

  const handleSlotSelect = (slotInfo: any) => {
    openCreateDialog(slotInfo.start, slotInfo.end)
  }

  const handleEventClick = (event: CalendarEvent) => {
    setActiveEventId(event.id)
    setEventTitle(event.title || "")
    setEventDescription(event.extendedProps?.description || "")
    setEventStart(event.start)
    setEventEnd(event.end || event.start)
    setEventColor(event.backgroundColor || "")
    setLinkedProject(event.extendedProps?.projectId || "")

    const provider = event.id.startsWith("google-") ? "google" :
                    event.id.startsWith("ms-") ? "microsoft" :
                    event.id.startsWith("local-") ? "local" : null
    setActiveEventProvider(provider)

    setIsEditDialogOpen(true)
  }

  // Flytter man starten, følger slutten med (samme varighet) – ellers kan slutt havne før start.
  const changeEventStart = (next: Date | null) => {
    if (next && eventStart && eventEnd) {
      const duration = eventEnd.getTime() - eventStart.getTime()
      setEventEnd(new Date(next.getTime() + (duration > 0 ? duration : 60 * 60 * 1000)))
    }
    setEventStart(next)
  }

  const endsBeforeStart = (start: Date | null, end: Date | null) =>
    Boolean(start && end && end.getTime() <= start.getTime())

  const handleCreateEvent = async () => {
    if (!eventTitle.trim() || !eventStart || !eventEnd) return
    if (endsBeforeStart(eventStart, eventEnd)) {
      toast.error("Avtalen må slutte etter at den starter.")
      return
    }
    setIsSubmitting(true)

    try {
      const res = await fetch("/api/calendar/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: eventTitle,
          start: eventStart.toISOString(),
          end: eventEnd.toISOString(),
          description: eventDescription,
          projectId: linkedProject || undefined,
        })
      })

      if (res.ok) {
        setIsCreateDialogOpen(false)
        triggerRefetch()
      } else {
        const data = await res.json()
        toast.error(`Kunne ikke lagre: ${data.error}`)
      }
    } catch (e) {
      reportClientError(e, { context: { action: "Opprette kalenderhendelse" } })
      toast.error("En feil oppstod ved lagring.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleUpdateEventDetails = async () => {
    if (!activeEventId || !eventTitle.trim() || !eventStart || !eventEnd) return
    if (endsBeforeStart(eventStart, eventEnd)) {
      toast.error("Avtalen må slutte etter at den starter.")
      return
    }
    setIsSubmitting(true)

    try {
      const res = await fetch("/api/calendar/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: activeEventId,
          title: eventTitle,
          description: eventDescription,
          start: eventStart.toISOString(),
          end: eventEnd.toISOString(),
          color: eventColor,
          projectId: linkedProject || undefined,
        })
      })

      if (res.ok) {
        setIsEditDialogOpen(false)
        triggerRefetch()
      } else {
        const data = await res.json()
        toast.error(`Kunne ikke lagre: ${data.error}`)
      }
    } catch (e) {
      console.error(e)
      reportClientError(e, { context: { action: "Oppdatere kalenderhendelse" } })
      toast.error("Kunne ikke lagre oppdateringen.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteEvent = async () => {
    if (!activeEventId) return
    const ok = await confirm({
      title: "Slette hendelse?",
      description: "Hendelsen slettes permanent fra kalenderen og kan ikke gjenopprettes.",
      confirmText: "Slett hendelse",
      cancelText: "Avbryt",
      variant: "destructive",
    })
    if (!ok) return
    setIsDeleting(true)

    try {
      const res = await fetch(`/api/calendar/events?eventId=${activeEventId}`, {
        method: "DELETE",
      })

      if (res.ok) {
        setIsEditDialogOpen(false)
        triggerRefetch()
      } else {
        const data = await res.json()
        toast.error(`Kunne ikke slette: ${data.error}`)
      }
    } catch (e) {
      reportClientError(e, { context: { action: "Slette kalenderhendelse" } })
      toast.error("En feil oppstod ved sletting.")
    } finally {
      setIsDeleting(false)
    }
  }

  const handleEventDropOrResize = async ({ event, start, end }: any) => {
    try {
      setEvents(prev => prev.map(e => e.id === event.id ? { ...e, start, end } : e))

      const res = await fetch("/api/calendar/events", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: event.id,
          start: start.toISOString(),
          end: end.toISOString(),
        })
      })

      if (!res.ok) {
         throw new Error("API error")
      }
      triggerRefetch()
    } catch (e) {
      console.error(e)
      reportClientError(e, { context: { action: "Flytte/endre kalenderhendelse" } })
      toast.error("Kunne ikke flytte/endre størrelse på møtet. Tilbakestiller visning.")
      triggerRefetch()
    }
  }

  const eventPropGetter = (event: CalendarEvent) => {
    return {
      style: {
        backgroundColor: event.backgroundColor || 'var(--primary)',
        borderColor: event.backgroundColor || 'var(--primary)',
        color: event.textColor || 'var(--primary-foreground)',
        borderRadius: 0,
      }
    }
  }

  if (loadingRole) {
    return (
      <AppPageShell segments={["Kalender"]} noPadding>
        <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
          Laster inn...
        </div>
      </AppPageShell>
    )
  }

  if (!hasFeature("kalender")) {
    return (
      <AppPageShell segments={["Kalender"]}>
        <PlanGate
          featureName="Kalender"
          description="Bedriftens delte kalender med prosjektkobling — følger med alle Proanbud-planer med aktivt abonnement."
        />
      </AppPageShell>
    )
  }

  return (
    <AppPageShell segments={["Kalender"]} noPadding>
      <div className="flex h-full min-h-0 flex-1 flex-col">
        {statusMessage && (
          <div className="border-b border-border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
            {statusMessage}
          </div>
        )}

        <CalendarToolbar
          date={date}
          view={view}
          onDateChange={setDate}
          onViewChange={setView}
          onAddEvent={handleAddEvent}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          visibleProvider={visibleProvider}
          onVisibleProviderChange={setVisibleProvider}
          integrations={integrations}
          onGoogleAuth={handleGoogleAuth}
          onOutlookAuth={handleOutlookAuth}
          onDisconnect={handleDisconnect}
          isDisconnecting={isDisconnecting}
        />

        {/* Mobil: månedsgrida kan bli høyere enn viewporten (min-h på dagceller) — la den scrolle. */}
        <div className="min-h-0 flex-1 overflow-y-auto md:overflow-hidden">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Laster inn...
            </div>
          ) : view === "month" ? (
            <MonthCalendar
              date={date}
              events={filteredEvents}
              onDayClick={handleDayClick}
              onEventClick={handleEventClick}
            />
          ) : (
            <DnDCalendar
              events={filteredEvents}
              date={date}
              view={view}
              onNavigate={setDate}
              onView={setView}
              min={minTime}
              max={maxTime}
              onSelectSlot={handleSlotSelect}
              onSelectEvent={handleEventClick}
              onEventDrop={handleEventDropOrResize}
              onEventResize={handleEventDropOrResize}
              eventPropGetter={eventPropGetter}
            />
          )}
        </div>
      </div>

      {/* Dagsark (mobil): dagens avtaler + «Ny avtale» — åpnes ved trykk på en dag. */}
      <ResponsiveDialog
        open={daySheetDate !== null}
        onOpenChange={(open) => {
          if (!open) setDaySheetDate(null)
        }}
      >
        <ResponsiveDialogContent className="px-2 md:p-4 sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="capitalize">
              {daySheetDate ? format(daySheetDate, "EEEE d. MMMM", { locale: nb }) : ""}
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-3 px-2 pb-4 md:px-0 md:pb-0">
            {daySheetEvents.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">
                Ingen avtaler denne dagen.
              </p>
            ) : (
              <div className="space-y-2">
                {daySheetEvents.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => {
                      setDaySheetDate(null)
                      handleEventClick(event)
                    }}
                    className="flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    <span
                      className="h-9 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: event.backgroundColor || "var(--primary)" }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {event.title || "(Uten tittel)"}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        {format(event.start, "HH:mm")}–{format(event.end ?? event.start, "HH:mm")}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            <Button size="lg"
              type="button"
              className="w-full gap-2"
              onClick={() => {
                if (!daySheetDate) return
                const { start, end } = defaultSlotTimes(daySheetDate)
                setDaySheetDate(null)
                openCreateDialog(start, end)
              }}
            >
              <Plus className="size-5" />
              Ny avtale
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <ResponsiveDialogContent className="px-2 md:p-4 sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Ny avtale</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-4 px-2 py-1 md:px-0">
            <div className="space-y-2">
              <Label htmlFor="title">Tittel</Label>
              <Input
                id="title"
                placeholder="F.eks. Møte med kunde"
                value={eventTitle}
                onChange={e => setEventTitle(e.target.value)}
                autoFocus
              />
              <Textarea
                id="description"
                placeholder="Beskrivelse (valgfritt)"
                value={eventDescription}
                onChange={e => setEventDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="create-start">Starter</Label>
                <DateTimeField id="create-start" value={eventStart} onChange={changeEventStart} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-end">Slutter</Label>
                <DateTimeField id="create-end" value={eventEnd} onChange={setEventEnd} />
              </div>
            </div>

            {projects.length > 0 && (
              <div className="space-y-2">
                <Label>Koble til prosjekt (valgfritt)</Label>
                <Select
                  value={linkedProject || "none"}
                  onValueChange={(v) => setLinkedProject(v === "none" ? "" : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Velg prosjekt" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ingen</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <ResponsiveDialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
              Avbryt
            </Button>
            <Button
              onClick={handleCreateEvent}
              disabled={!eventTitle.trim() || !eventStart || !eventEnd || isSubmitting}
            >
              {isSubmitting ? "Lagrer..." : "Lagre avtale"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      <ResponsiveDialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <ResponsiveDialogContent className="px-2 md:p-4 sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Rediger avtale</ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-4 px-2 py-1 md:px-0">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Tittel</Label>
              <Input
                id="edit-title"
                placeholder="Tittel"
                value={eventTitle}
                onChange={e => setEventTitle(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-desc">Beskrivelse</Label>
              <Textarea
                id="edit-desc"
                placeholder="Beskrivelse"
                value={eventDescription}
                onChange={e => setEventDescription(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="edit-start">Starter</Label>
                <DateTimeField id="edit-start" value={eventStart} onChange={changeEventStart} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-end">Slutter</Label>
                <DateTimeField id="edit-end" value={eventEnd} onChange={setEventEnd} />
              </div>
            </div>

            {projects.length > 0 && (
              <div className="space-y-2">
                <Label>Koble til prosjekt</Label>
                <Select
                  value={linkedProject || "none"}
                  onValueChange={(v) => setLinkedProject(v === "none" ? "" : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Velg et prosjekt (valgfritt)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Ingen</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Farge lagres kun for Proanbud-avtaler — Google/Outlook styrer
                fargene sine selv (colorId-paletten deres matcher ikke hex). */}
            {activeEventProvider === 'local' && (
              <div className="space-y-2">
                <Label>Farge i kalender</Label>
                <div className="flex flex-wrap gap-2">
                  {['#4285F4', '#EA4335', '#FBBC05', '#34A853', '#8E24AA', '#0078D4', '#7986CB'].map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setEventColor(color)}
                      style={{ backgroundColor: color }}
                      className={`size-9 rounded-full border-2 ${eventColor === color ? 'border-foreground' : 'border-transparent'}`}
                      aria-label={`Velg farge ${color}`}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="pt-2 text-xs text-muted-foreground">
              Vises på: {activeEventProvider === 'local' ? 'Proanbud-kalenderen' : activeEventProvider === 'google' ? 'Google Calendar' : activeEventProvider === 'microsoft' ? 'Outlook Calendar' : 'Ukjent kalender'}
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="destructive"
              className="sm:order-first sm:mr-auto"
              onClick={handleDeleteEvent}
              disabled={isDeleting || isSubmitting}
            >
              {isDeleting ? "Sletter..." : "Slett avtale"}
            </Button>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isDeleting || isSubmitting}>Avbryt</Button>
            <Button onClick={handleUpdateEventDetails} disabled={!eventTitle.trim() || isSubmitting || isDeleting}>
              {isSubmitting ? "Lagrer..." : "Lagre endringer"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

      {/* Påkoblingsfasen: valg om å kopiere Proanbud-kalenderen til den
          nytilkoblede eksterne kalenderen. */}
      <ResponsiveDialog
        open={importPromptProvider !== null}
        onOpenChange={(open) => {
          if (!open) setImportPromptProvider(null)
        }}
      >
        <ResponsiveDialogContent className="px-2 md:p-4 sm:max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>
              Kopiere avtalene til {importPromptProvider === "google" ? "Google" : "Outlook"}?
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
          <div className="space-y-2 px-2 py-1 text-sm text-muted-foreground md:px-0">
            <p>
              Kommende avtaler fra Proanbud-kalenderen kan kopieres til{" "}
              {importPromptProvider === "google" ? "Google Kalender" : "Outlook-kalenderen"} din nå.
            </p>
            <p>
              Nye avtaler du oppretter i Proanbud legges automatisk inn i tilkoblede kalendere
              fremover, så dette gjelder bare det som allerede ligger i kalenderen.
            </p>
          </div>
          <ResponsiveDialogFooter>
            <Button
              variant="outline"
              onClick={() => setImportPromptProvider(null)}
              disabled={isImporting}
            >
              Nei takk
            </Button>
            <Button onClick={handleImportToProvider} disabled={isImporting}>
              {isImporting ? "Kopierer..." : "Kopier avtaler"}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>

    </AppPageShell>
  )
}

function KalenderFallback() {
  return (
    <AppPageShell segments={["Kalender"]} noPadding>
      <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        Laster kalender…
      </div>
    </AppPageShell>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<KalenderFallback />}>
      <KalenderPage />
    </Suspense>
  )
}
