"use client"

// Heavy week/day calendar grid — isolated into its own module so it is loaded
// lazily (next/dynamic, ssr:false) only when the user actually switches to a
// week/day view. react-big-calendar + its drag-and-drop addon are the heaviest
// chunk in the app; keeping them out of the /kalender first-load JS is the win.
// Uses dateFnsLocalizer (not moment) so the moment dependency is not bundled.

import { dateFnsLocalizer } from "react-big-calendar"
import withDragAndDrop from "react-big-calendar/lib/addons/dragAndDrop"
import { format, parse, startOfWeek, getDay } from "date-fns"
import { nb } from "date-fns/locale"

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
        selectable
        resizable
        onSelectSlot={onSelectSlot}
        onSelectEvent={onSelectEvent}
        onEventDrop={onEventDrop}
        onEventResize={onEventResize}
        eventPropGetter={eventPropGetter}
        messages={MESSAGES}
      />
    </div>
  )
}
