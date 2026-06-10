"use client";

import { AppPageShell } from "@/components/app-page-shell"
import { Button } from "@/components/ui/button"
import { Suspense, useState, useEffect, useCallback, useMemo } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { LOGIN_PATH } from '@/lib/constants'

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"

import { momentLocalizer, Views } from "react-big-calendar"
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop"
import ShadcnBigCalendar from "@/components/ui/shadcn-big-calendar"
import moment from "moment"
import "moment/locale/nb"

import { CalendarToolbar, type CalendarView } from "./calendar-toolbar"
import { MonthCalendar } from "./month-calendar"

moment.locale("nb");
const localizer = momentLocalizer(moment);
const DnDCalendar = withDragAndDrop<CalendarEvent>(ShadcnBigCalendar as any);

type CalendarEvent = {
  id: string
  title: string
  start: Date
  end: Date
  description?: string
  backgroundColor?: string
  textColor?: string
  extendedProps?: any
}

function defaultSlotTimes(day: Date) {
  const start = new Date(day)
  start.setHours(9, 0, 0, 0)
  const end = new Date(day)
  end.setHours(10, 0, 0, 0)
  return { start, end }
}

function KalenderPage() {
  const [integrations, setIntegrations] = useState<{ provider: string }[]>([])
  const [loggedIn, setLoggedIn] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  const [view, setView] = useState<CalendarView>(Views.MONTH)
  const [date, setDate] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [fetchRange, setFetchRange] = useState<{start: string, end: string} | null>(null)

  const [timeRange, setTimeRange] = useState<"work" | "full">("work")
  const [visibleProvider, setVisibleProvider] = useState<"all" | "google" | "microsoft">("all")

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)

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
    } catch {
      setLoggedIn(false)
      setIntegrations([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    loadIntegrations()
  }, [loadIntegrations])

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

    const startD = moment(date).startOf('month').subtract(1, 'month').toDate()
    const endD = moment(date).endOf('month').add(1, 'month').toDate()

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
    if (!confirm(`Koble fra ${provider === "google" ? "Google" : "Outlook"} Calendar?`)) return
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
    } catch {
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
    const { start, end } = defaultSlotTimes(day)
    openCreateDialog(start, end)
  }

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
          description: eventDescription
        })
      })

      if (res.ok) {
        setIsCreateDialogOpen(false)
        triggerRefetch()
      } else {
        const data = await res.json()
        alert(`Kunne ikke lagre: ${data.error}`)
      }
    } catch (e) {
      alert("En feil oppstod ved lagring.")
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
          projectId: linkedProject
        })
      })

      if (res.ok) {
        setIsEditDialogOpen(false)
        triggerRefetch()
      } else {
        const data = await res.json()
        alert(`Kunne ikke lagre: ${data.error}`)
      }
    } catch (e) {
      console.error(e)
      alert("Kunne ikke lagre oppdateringen.")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDeleteEvent = async () => {
    if (!activeEventId) return
    if (!confirm("Er du sikker på at du vil slette dette eventet?")) return
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
        alert(`Kunne ikke slette: ${data.error}`)
      }
    } catch (e) {
      alert("En feil oppstod ved sletting.")
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
      alert("Kunne ikke flytte/endre størrelse på møtet. Tilbakestiller visning.")
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

        <div className="min-h-0 flex-1 overflow-hidden">
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
                <Button variant="outline" className="rounded-none" onClick={handleGoogleAuth}>
                  Koble til Google
                </Button>
                <Button variant="outline" className="rounded-none" onClick={handleOutlookAuth}>
                  Koble til Outlook
                </Button>
              </div>
            </div>
          ) : view === Views.MONTH ? (
            <MonthCalendar
              date={date}
              events={filteredEvents}
              onDayClick={handleDayClick}
              onEventClick={handleEventClick}
            />
          ) : (
            <div className="h-full min-h-0">
              <DnDCalendar
                localizer={localizer}
                events={filteredEvents}
                style={{ height: "100%" }}
                date={date}
                view={view}
                onNavigate={(newDate: Date) => setDate(newDate)}
                onView={(newView) => setView(newView as CalendarView)}
                min={minTime}
                max={maxTime}
                selectable
                resizable
                onSelectSlot={handleSlotSelect}
                onSelectEvent={handleEventClick}
                onEventDrop={handleEventDropOrResize}
                onEventResize={handleEventDropOrResize}
                eventPropGetter={eventPropGetter}
                messages={{
                  today: "I dag",
                  previous: "Forrige",
                  next: "Neste",
                  month: "Måned",
                  week: "Uke",
                  day: "Dag",
                  agenda: "Agenda",
                  date: "Dato",
                  time: "Tid",
                  event: "Hendelse",
                  allDay: "Hele dagen",
                  noEventsInRange: "Ingen hendelser i denne perioden.",
                  showMore: (total) => `+${total} flere`
                }}
              />
            </div>
          )}
        </div>
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent className="rounded-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ny hendelse</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="title">Tittel</Label>
              <Input
                id="title"
                placeholder="F.eks. Møte med kunde"
                value={eventTitle}
                onChange={e => setEventTitle(e.target.value)}
                autoFocus
                className="rounded-none"
              />
              <Textarea
                id="description"
                placeholder="Beskrivelse (valgfritt)"
                value={eventDescription}
                onChange={e => setEventDescription(e.target.value)}
                className="rounded-none"
              />
            </div>

            <div className="space-y-2 border border-border p-3 text-sm text-muted-foreground">
              <p><strong>Starter:</strong> {eventStart?.toLocaleString("no-NB")}</p>
              <p><strong>Slutter:</strong> {eventEnd?.toLocaleString("no-NB")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="rounded-none" onClick={() => setIsCreateDialogOpen(false)}>Avbryt</Button>
            <Button className="rounded-none" onClick={handleCreateEvent} disabled={!eventTitle.trim() || isSubmitting}>
              {isSubmitting ? "Lagrer..." : "Lagre avtale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="rounded-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Hendelsesdetaljer</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Tittel</Label>
              <Input
                id="edit-title"
                placeholder="Tittel"
                value={eventTitle}
                onChange={e => setEventTitle(e.target.value)}
                autoFocus
                className="rounded-none"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-desc">Beskrivelse</Label>
              <Textarea
                id="edit-desc"
                placeholder="Beskrivelse"
                value={eventDescription}
                onChange={e => setEventDescription(e.target.value)}
                className="rounded-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Starttidspunkt</Label>
                <Input type="datetime-local" className="rounded-none" value={eventStart ? new Date(eventStart.getTime() - eventStart.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onChange={(e) => setEventStart(new Date(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Sluttidspunkt</Label>
                <Input type="datetime-local" className="rounded-none" value={eventEnd ? new Date(eventEnd.getTime() - eventEnd.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onChange={(e) => setEventEnd(new Date(e.target.value))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Koble til prosjekt</Label>
              <Select value={linkedProject} onValueChange={setLinkedProject}>
                <SelectTrigger className="rounded-none">
                  <SelectValue placeholder="Velg et prosjekt (valgfritt)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen</SelectItem>
                  <SelectItem value="project-1">Prosjekt Alpha</SelectItem>
                  <SelectItem value="project-2">Prosjekt Beta</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Farge i kalender</Label>
              <div className="flex gap-2">
                {['#4285F4', '#EA4335', '#FBBC05', '#34A853', '#8E24AA', '#0078D4', '#7986CB'].map((color) => (
                  <button
                    key={color}
                    onClick={() => setEventColor(color)}
                    style={{ backgroundColor: color }}
                    className={`size-8 border-2 ${eventColor === color ? 'border-foreground' : 'border-transparent'}`}
                    aria-label={`Velg farge ${color}`}
                  />
                ))}
              </div>
            </div>

            <div className="pt-2 text-xs text-muted-foreground">
              Vises på: {activeEventProvider === 'google' ? 'Google Calendar' : activeEventProvider === 'microsoft' ? 'Outlook Calendar' : 'Ukjent kalender'}
            </div>
          </div>
          <DialogFooter className="flex w-full items-center justify-between sm:justify-between">
            <Button variant="destructive" className="rounded-none" onClick={handleDeleteEvent} disabled={isDeleting || isSubmitting}>
              {isDeleting ? "Sletter..." : "Slett hendelse"}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-none" onClick={() => setIsEditDialogOpen(false)} disabled={isDeleting || isSubmitting}>Avbryt</Button>
              <Button className="rounded-none" onClick={handleUpdateEventDetails} disabled={!eventTitle.trim() || isSubmitting || isDeleting}>
                {isSubmitting ? "Lagrer..." : "Lagre endringer"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
