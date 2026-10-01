"use client"

// Heavy week/day calendar grid — isolated into its own module so it is loaded
// lazily (next/dynamic, ssr:false) only when the user actually switches to a
// week/day view. react-big-calendar + its drag-and-drop addon are the heaviest
// chunk in the app; keeping them out of the /kalender first-load JS is the win.
// Uses dateFnsLocalizer (not moment) so the moment dependency is not bundled.

import { dateFnsLocalizer } from "react-big-calendar"
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop"
import { format, parse, startOfWeek, getDay, isSameDay, isToday } from "date-fns"
import { nb } from "date-fns/locale"

import { useMemo } from "react"
import { cn } from "@/lib/utils"
import ShadcnBigCalendar from "@/components/ui/shadcn-big-calendar"
import type { CalendarEvent } from "./types"
import type { CalendarView } from "./calendar-toolbar"

const locales = { nb }
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales })

const DnDCalendar = withDragAndDrop<CalendarEvent>(ShadcnBigCalendar as any)

const MESSAGES = {
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
  showMore: (total: number) => `+${total} flere`,
}

const FORMATS = {
  timeGutterFormat: "HH:mm",
  eventTimeRangeFormat: ({ start, end }: { start: Date; end: Date }) =>
    `${format(start, "HH:mm")}–${format(end, "HH:mm")}`,
  selectRangeFormat: ({ start, end }: { start: Date; end: Date }) =>
    `${format(start, "HH:mm")}–${format(end, "HH:mm")}`,
}

/** Kolonneoverskrift i uke/dag: «MAN» over datoen, dagens dato i en sirkel. */
function DayHeader({ date }: { date: Date }) {
  const today = isToday(date)
  return (
    <span className="flex flex-col items-center gap-0.5 py-1.5">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {format(date, "EEE", { locale: nb }).replace(".", "")}
      </span>
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-sm tabular-nums",
          today ? "bg-primary font-semibold text-primary-foreground" : "text-foreground"
        )}
      >
        {format(date, "d")}
      </span>
    </span>
  )
}

/** Hendelse i tidsrutenettet: tittel først, klokkeslett under (skjules når det ikke er plass). */
function TimeEvent({ event }: { event: CalendarEvent }) {
  // Flerdagshendelser ligger i heldagsraden — der er det kun plass til én linje.
  if (!isSameDay(event.start, event.end)) {
    return <span className="block truncate text-xs font-medium">{event.title || "(Uten tittel)"}</span>
  }
  return (
    <span className="flex h-full min-w-0 flex-col overflow-hidden leading-tight">
      <span className="truncate text-xs font-medium">{event.title || "(Uten tittel)"}</span>
      <span className="truncate text-[11px] tabular-nums opacity-80">
        {format(event.start, "HH:mm")}–{format(event.end, "HH:mm")}
      </span>
    </span>
  )
}

const COMPONENTS = {
  header: DayHeader,
  event: TimeEvent,
}

type DndCalendarProps = {
  events: CalendarEvent[]
  date: Date
  view: CalendarView
  min: Date
  max: Date
  onNavigate: (date: Date) => void
  onView: (view: CalendarView) => void
  onSelectSlot: (slotInfo: any) => void
  onSelectEvent: (event: CalendarEvent) => void
  onEventDrop: (args: any) => void
  onEventResize: (args: any) => void
  eventPropGetter: (event: CalendarEvent) => { style: React.CSSProperties }
}

export default function DndCalendar({
  events,
  date,
  view,
  min,
  max,
  onNavigate,
  onView,
  onSelectSlot,
  onSelectEvent,
  onEventDrop,
  onEventResize,
  eventPropGetter,
}: DndCalendarProps) {
  // Arbeidstid: start øverst (06:00). Hele døgnet: hopp til 07:00 i stedet for
  // midnatt. Ellers lander scrollen midt i en time og morgenavtalene kuttes.
  // Memoisert: ny verdi = ny scroll.
  const scrollToTime = useMemo(() => {
    const d = new Date(min)
    d.setHours(min.getHours() === 0 ? 7 : min.getHours(), 0, 0, 0)
    return d
  }, [min])

  return (
    <div className="h-full min-h-0">
      <DnDCalendar
        localizer={localizer}
        culture="nb"
        events={events}
        style={{ height: "100%" }}
        date={date}
        view={view}
        onNavigate={onNavigate}
        onView={(newView) => onView(newView as CalendarView)}
        min={min}
        max={max}
        scrollToTime={scrollToTime}
        selectable
        resizable
        onSelectSlot={onSelectSlot}
        onSelectEvent={onSelectEvent}
        onEventDrop={onEventDrop}
        onEventResize={onEventResize}
        eventPropGetter={eventPropGetter}
        messages={MESSAGES}
        formats={FORMATS}
        components={COMPONENTS}
        showMultiDayTimes={false}
      />
    </div>
  )
}
