"use client";

import { AppPageShell } from "@/components/app-page-shell"
import { Button } from "@/components/ui/button"
import { useState, useEffect, useCallback, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { LOGIN_PATH } from '@/lib/constants'

// UI for creating events
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"

// react-big-calendar
import { momentLocalizer, Views } from "react-big-calendar"
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop"
import ShadcnBigCalendar from "@/components/ui/shadcn-big-calendar"
import moment from "moment"
import "moment/locale/nb" // Norsk lokal tid

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

export default function Page() {
  const [integrations, setIntegrations] = useState<{ provider: string }[]>([])
  const [loggedIn, setLoggedIn] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  
  // Big Calendar State
  const [view, setView] = useState(Views.WEEK)
  const [date, setDate] = useState(new Date())
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [fetchRange, setFetchRange] = useState<{start: string, end: string} | null>(null)
  
  // View Settings
  const [timeRange, setTimeRange] = useState<"work" | "full">("work")
  const [visibleProvider, setVisibleProvider] = useState<"all" | "google" | "microsoft">("all")

  // Dialog states for Create and Edit
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  
  // Create / Edit Form State
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

  // Configure visible hours
  
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

  useEffect(() => {
    const supabase = createClient()
    ;(async () => {
      try {
        const { data: userData } = await supabase.auth.getUser()
        if (userData?.user) {
          setLoggedIn(true)
          const { data } = await supabase
            .from('calendar_integrations')
            .select('provider')
            .eq('user_id', userData.user.id)
            
          if (data) {
             setIntegrations(data)
          }
        }
      } catch (e) {
        setLoggedIn(false)
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  // Auto-fetch events when the view range changes
  useEffect(() => {
    if (!loggedIn || integrations.length === 0) return
    
    let startD = moment(date).startOf('month').subtract(1, 'month').toDate()
    let endD = moment(date).endOf('month').add(1, 'month').toDate()
    
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
    window.location.href = "/api/auth/google/start"
  }

  const handleOutlookAuth = () => {
    if (!loggedIn) {
      window.location.href = LOGIN_PATH
      return
    }
    window.location.href = "/api/auth/microsoft/start"
  }

  const hasIntegration = integrations.length > 0;
  const hasBothIntegrations = integrations.some(i => i.provider === 'google') && integrations.some(i => i.provider === 'microsoft');

  const filteredEvents = useMemo(() => {
    if (visibleProvider === "all") return events;
    if (visibleProvider === "google") return events.filter(e => e.id.startsWith("google-"));
    if (visibleProvider === "microsoft") return events.filter(e => e.id.startsWith("ms-"));
    return events;
  }, [events, visibleProvider]);

  const handleSlotSelect = (slotInfo: any) => {
    setEventTitle("")
    setEventDescription("")
    setEventStart(slotInfo.start)
    setEventEnd(slotInfo.end)
    setEventColor("")
    setLinkedProject("")
    setIsCreateDialogOpen(true)
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
        color: event.textColor || 'var(--primary-foreground)'
      }
    }
  }

  return (
    <AppPageShell segments={["Kalender"]}>
      <div className="flex flex-col gap-2 w-full h-full max-w-6xl mx-auto mb-4">

        {/* Header / Connect buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-4 py-2 border rounded-xl bg-card">
            <div className="flex flex-col">
              <h2 className="text-xl font-semibold">Din Kalender</h2>
              <p className="text-sm text-muted-foreground" hidden>
                Koble til kontoene dine for å se og administrere møter.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={timeRange} onValueChange={(v: any) => setTimeRange(v)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Visningsperiode" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Visningsperiode</SelectLabel>
                  <SelectItem value="work">Arbeidstid (06:00-18:00)</SelectItem>
                  <SelectItem value="full">Hele døgnet (00:00-24:00)</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>

            {(hasBothIntegrations) && (
              <Select value={visibleProvider} onValueChange={(v: any) => setVisibleProvider(v)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Innholdskilde" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Velg kilde</SelectLabel>
                    <SelectItem value="all">Begge integrasjoner</SelectItem>
                    <SelectItem value="google">Google</SelectItem>
                    <SelectItem value="microsoft">Microsoft</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}

            {!integrations.some(i => i.provider === 'google') && (
              <Button onClick={handleGoogleAuth} variant="outline" className="flex items-center gap-2">
                <img src="https://www.gstatic.com/images/branding/product/1x/calendar_48dp.png" alt="Google" className="w-5 h-5" />
                Koble til Google
              </Button>
            )}
            {!integrations.some(i => i.provider === 'microsoft') && (
              <Button onClick={handleOutlookAuth} variant="outline" className="flex items-center gap-2">
                <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Microsoft_365_%282022%29.svg/330px-Microsoft_365_%282022%29.svg.png" alt="Outlook" className="w-5 h-5" />
                 Koble til Outlook
              </Button>
            )}
          </div>
        </div>

        <div className="w-full bg-card rounded-xl flex flex-col h-[calc(100vh-200px)]">
          {isLoading ? (
            <div className="w-full flex-grow flex items-center justify-center">Laster inn...</div>
          ) : !hasIntegration ? (
            <div className="w-full flex-grow flex flex-col items-center justify-center text-muted-foreground">
               Ingen kalender tilkoblet enda. Koble til Google eller Outlook over for å se hendelsene dine.
            </div>
          ) : (
             <div className="flex-grow w-full h-fit border rounded-lg">
                <DnDCalendar
                  localizer={localizer}
                  events={filteredEvents}
                  style={{ height: '100%' }}
                  date={date}
                  view={view}
                  onNavigate={(newDate: Date) => setDate(newDate)}
                  onView={(newView: any) => setView(newView)}
                  min={minTime}
                  max={maxTime}
                  selectable
                  resizable
                  onSelectSlot={handleSlotSelect}
                  onSelectEvent={handleEventClick}
                  onEventDrop={handleEventDropOrResize}
                  onEventResize={handleEventDropOrResize}
                  eventPropGetter={eventPropGetter}
                  className="rounded-lg"
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

      {/* New Event Dialog */}
      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nytt event</DialogTitle>
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
              />
              <Textarea
                id="description"
                placeholder="Beskrivelse (valgfritt)"
                value={eventDescription}
                onChange={e => setEventDescription(e.target.value)}
              />
            </div>
            
            <div className="space-y-2 text-sm text-muted-foreground p-3 bg-muted rounded-lg border">
              <p>📍 <strong>Starter:</strong> {eventStart?.toLocaleString("no-NB")}</p>
              <p>📌 <strong>Slutter:</strong> {eventEnd?.toLocaleString("no-NB")}</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>Avbryt</Button>
            <Button onClick={handleCreateEvent} disabled={!eventTitle.trim() || isSubmitting}>
              {isSubmitting ? "Lagrer..." : "Lagre avtale"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Se/Endre Møte Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Møtedetaljer</DialogTitle>
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Starttidspunkt</Label>
                <Input type="datetime-local" value={eventStart ? new Date(eventStart.getTime() - eventStart.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onChange={(e) => setEventStart(new Date(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Sluttidspunkt</Label>
                <Input type="datetime-local" value={eventEnd ? new Date(eventEnd.getTime() - eventEnd.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""} onChange={(e) => setEventEnd(new Date(e.target.value))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Koble til prosjekt</Label>
              <Select value={linkedProject} onValueChange={setLinkedProject}>
                <SelectTrigger>
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
                    className={`w-8 h-8 rounded-full border-2 ${eventColor === color ? 'border-foreground' : 'border-transparent'}`}
                    aria-label={`Velg farge ${color}`}
                  />
                ))}
              </div>
            </div>

            <div className="pt-2 text-xs text-muted-foreground">
              Vises på: {activeEventProvider === 'google' ? 'Google Calendar' : activeEventProvider === 'microsoft' ? 'Outlook Calendar' : 'Ukjent kalender'}
            </div>
          </div>
          <DialogFooter className="flex justify-between sm:justify-between items-center w-full">
            <Button variant="destructive" onClick={handleDeleteEvent} disabled={isDeleting || isSubmitting}>
              {isDeleting ? "Sletter..." : "Slett møte"}
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)} disabled={isDeleting || isSubmitting}>Avbryt</Button>
              <Button onClick={handleUpdateEventDetails} disabled={!eventTitle.trim() || isSubmitting || isDeleting}>
                {isSubmitting ? "Lagrer..." : "Lagre endringer"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppPageShell>
  )
}