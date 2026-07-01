"use client";

import { AppPageShell } from "@/components/app-page-shell"
import { Button } from "@/components/ui/button"
import { Suspense, useState, useEffect, useCallback, useMemo } from "react"
import dynamic from "next/dynamic"
import { useSearchParams } from "next/navigation"
import {
  addMonths,
  endOfDay,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subMonths,
} from "date-fns"
import { nb } from "date-fns/locale"
import { Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"

import { CalendarToolbar, type CalendarView } from "./calendar-toolbar"
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

function defaultSlotTimes(day: Date) {
  const start = new Date(day)
  start.setHours(9, 0, 0, 0)
  const end = new Date(day)
  end.setHours(10, 0, 0, 0)
  return { start, end }
}

// <input type="datetime-local"> exchanges a bare "YYYY-MM-DDTHH:mm" string with
// no timezone offset. `new Date(value)` on that form is NOT portable: V8 (Chrome)
// parses it as LOCAL time, but JavaScriptCore (Safari) parses it as UTC — so on
// Safari reading the field back shifts the saved event by the user's offset
// (1–2 h in Norway), and that wrong time is persisted via toISOString() and
// synced to Google/Microsoft/Tripletex. Going through explicit local components
// (the `new Date(y, m, d, ...)` constructor is local on every engine) fixes it.
function parseLocalDatetimeInput(value: string): Date | null {
  if (!value) return null
  const [datePart, timePart] = value.split("T")
  if (!datePart || !timePart) return null
  const [year, month, day] = datePart.split("-").map(Number)
  const [hour, minute] = timePart.split(":").map(Number)
  if ([year, month, day, hour, minute].some(Number.isNaN)) return null
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

function formatLocalDatetimeInput(date: Date | null): string {
  if (!date) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function KalenderPage() {
  const isMobile = useIsMobile()
  const confirm = useConfirm()
  const { loadingRole, hasFeature } = useUserRole()
  const [integrations, setIntegrations] = useState<{ provider: string }[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [loggedIn, setLoggedIn] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const [view, setView] = useState<CalendarView>("month")
  const [date, setDate] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [fetchRange, setFetchRange] = useState<{start: string, end: string} | null>(null)

  const [timeRange, setTimeRange] = useState<"work" | "full">("work")
  const [visibleProvider, setVisibleProvider] = useState<"all" | "google" | "microsoft">("all")

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
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

  const fetchEvents = useCallback(async (startIso: string, endIso: string) => {
    try {
      const res = await fetch(`/api/calendar/events?start=${encodeURIComponent(startIso)}&end=${encodeURIComponent(endIso)}`)
      if (res.ok) {
        const data = await res.json()
        const formattedEvents = data.map((e: any) => ({
          ...e,
          start: new Date(e.start),
          end: new Date(e.end),
          extendedProps: {
             description: e.description,
             projectId: e.projectId
          }
        }))
        setEvents(formattedEvents)
      }
    } catch (e) {
      console.error("Failed to fetch events", e)
      reportClientError(e, { level: "warning", context: { action: "Hente kalenderhendelser" } })
    }
  }, [])

  const loadIntegrations = useCallback(async () => {
    const supabase = createClient()
    try {
      const { data: userData } = await supabase.auth.getUser()
      if (userData?.user) {
        setLoggedIn(true)
        const { data } = await supabase
          .from('calendar_integrations')
          .select('provider')
          .eq('user_id', userData.user.id)

        setIntegrations(data ?? [])
      } else {
        setLoggedIn(false)
        setIntegrations([])
      }
    } catch (e) {
      reportClientError(e, { level: "warning", context: { action: "Laste kalenderintegrasjoner" } })
      setLoggedIn(false)
      setIntegrations([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadIntegrations()
  }, [loadIntegrations])

  // Prosjektliste til «Koble til prosjekt» — RLS begrenser til brukerens egne prosjekter.
  useEffect(() => {
    if (!loggedIn) return
    const supabase = createClient()
    supabase
      .from("projects")
      .select("id, name")
      .eq("status", "active")
      .order("name")
      .limit(100)
      .then(({ data }) => setProjects(data ?? []))
  }, [loggedIn])

  useEffect(() => {
    const connected = searchParams.get("calendar_connected")
    const error = searchParams.get("calendar_error")

    if (connected === "google") {
      setStatusMessage("Google Calendar er tilkoblet.")
      loadIntegrations()
    } else if (connected === "microsoft") {
      setStatusMessage("Outlook Calendar er tilkoblet.")
      loadIntegrations()
    } else if (error) {
      setStatusMessage(`Kunne ikke koble til kalender: ${error}`)
    }
  }, [searchParams, loadIntegrations])

  useEffect(() => {
    if (!loggedIn || integrations.length === 0) return

    const startD = subMonths(startOfMonth(date), 1)
    const endD = addMonths(endOfMonth(date), 1)

    setFetchRange({
       start: startD.toISOString(),
       end: endD.toISOString()
    })
  }, [date, view, loggedIn, integrations])

  useEffect(() => {
    if (fetchRange) {
      fetchEvents(fetchRange.start, fetchRange.end)
    }
  }, [fetchRange, fetchEvents])

  const triggerRefetch = () => {
     if (fetchRange) {
        fetchEvents(fetchRange.start, fetchRange.end)
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
        setEvents([])
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

  const hasIntegration = integrations.length > 0;
  const hasBothIntegrations = integrations.some(i => i.provider === 'google') && integrations.some(i => i.provider === 'microsoft');

  const filteredEvents = useMemo(() => {
    if (visibleProvider === "all") return events;
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
                    event.id.startsWith("ms-") ? "microsoft" : null
    setActiveEventProvider(provider)

    setIsEditDialogOpen(true)
  }

  const handleCreateEvent = async () => {
    if (!eventTitle.trim() || !eventStart || !eventEnd) return
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
          description="Koble til Google og Outlook for å se og administrere avtalene dine direkte i Proanbud."
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
          hasBothIntegrations={hasBothIntegrations}
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
          ) : !hasIntegration ? (
            <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="max-w-md text-sm text-muted-foreground">
                Ingen kalender tilkoblet enda. Koble til Google eller Outlook for å se og administrere hendelsene dine.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="outline" onClick={handleGoogleAuth}>
                  Koble til Google
                </Button>
                <Button variant="outline" onClick={handleOutlookAuth}>
                  Koble til Outlook
                </Button>
              </div>
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
            <Button
              type="button"
              className="h-12 w-full gap-2"
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
                <Input
                  id="create-start"
                  type="datetime-local"
                  value={formatLocalDatetimeInput(eventStart)}
                  onChange={(e) => setEventStart(parseLocalDatetimeInput(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="create-end">Slutter</Label>
                <Input
                  id="create-end"
                  type="datetime-local"
                  value={formatLocalDatetimeInput(eventEnd)}
                  onChange={(e) => setEventEnd(parseLocalDatetimeInput(e.target.value))}
                />
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
                <Input id="edit-start" type="datetime-local" value={formatLocalDatetimeInput(eventStart)} onChange={(e) => setEventStart(parseLocalDatetimeInput(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-end">Slutter</Label>
                <Input id="edit-end" type="datetime-local" value={formatLocalDatetimeInput(eventEnd)} onChange={(e) => setEventEnd(parseLocalDatetimeInput(e.target.value))} />
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

            <div className="pt-2 text-xs text-muted-foreground">
              Vises på: {activeEventProvider === 'google' ? 'Google Calendar' : activeEventProvider === 'microsoft' ? 'Outlook Calendar' : 'Ukjent kalender'}
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
