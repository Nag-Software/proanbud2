"use client"

import {
  addDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { nb } from "date-fns/locale"
import { Plus } from "lucide-react"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export type MonthCalendarEvent = {
  id: string
  title: string
  start: Date
  end: Date
  backgroundColor?: string
  textColor?: string
}

type MonthCalendarProps = {
  date: Date
  events: MonthCalendarEvent[]
  onDayClick: (day: Date) => void
  onEventClick: (event: MonthCalendarEvent) => void
  /** «+N flere» — viser alle dagens avtaler. Faller tilbake til onDayClick. */
  onShowMore?: (day: Date) => void
}

const WEEKDAY_LABELS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"]

// Brikkene har fast høyde (h-5) og 2px mellomrom — antallet som får plass i en
// dagcelle regnes ut fra målt høyde, så de aldri klemmes sammen eller dytter
// dagnummeret ut av cellen (6-ukersmåneder / lave vinduer).
const CHIP_SLOT_PX = 22
const DEFAULT_SLOTS = 3

function getEventsForDay(events: MonthCalendarEvent[], day: Date) {
  const dayStart = startOfDay(day)
  const dayEnd = endOfDay(day)

  return events
    .filter((event) => event.start <= dayEnd && event.end >= dayStart)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
}

export function MonthCalendar({
  date,
  events,
  onDayClick,
  onEventClick,
  onShowMore,
}: MonthCalendarProps) {
  const weeks = useMemo(() => {
    const monthStart = startOfMonth(date)
    const monthEnd = endOfMonth(date)
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 })
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

    const days: Date[] = []
    let cursor = gridStart
    while (cursor <= gridEnd) {
      days.push(cursor)
      cursor = addDays(cursor, 1)
    }

    const rows: Date[][] = []
    for (let i = 0; i < days.length; i += 7) {
      rows.push(days.slice(i, i + 7))
    }
    return rows
  }, [date])

  // Alle dagceller er like høye — det holder å måle hendelsesflaten i én av dem.
  const measureRef = useRef<HTMLDivElement>(null)
  const [slots, setSlots] = useState(DEFAULT_SLOTS)
  useLayoutEffect(() => {
    const el = measureRef.current
    if (!el) return
    const update = () => {
      const next = Math.max(1, Math.floor((el.clientHeight + 2) / CHIP_SLOT_PX))
      setSlots((prev) => (prev === next ? prev : next))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
    // Ny måned = nye dagceller (nøklene er datoer) — mål den nye cellen.
  }, [weeks])

  const showMore = onShowMore ?? onDayClick

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="border-r border-border px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground last:border-r-0"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid min-h-0 flex-1 grid-cols-7">
            {week.map((day, dayIndex) => {
              const dayEvents = getEventsForDay(events, day)
              const inMonth = isSameMonth(day, date)
              const today = isToday(day)
              const overflow = dayEvents.length > slots
              const visible = overflow ? dayEvents.slice(0, Math.max(0, slots - 1)) : dayEvents
              const hidden = dayEvents.length - visible.length

              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "group relative flex min-h-[5rem] min-w-0 flex-col border-b border-r border-border last:border-r-0 sm:min-h-0",
                    !inMonth && "bg-muted/30"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onDayClick(day)}
                    className="absolute inset-0 z-0 transition-colors hover:bg-muted/40"
                    aria-label={format(day, "d. MMMM yyyy", { locale: nb })}
                  />

                  <div className="pointer-events-none relative z-10 flex h-7 shrink-0 items-center justify-between px-1.5 pt-1">
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
                        inMonth ? "text-foreground" : "text-muted-foreground",
                        today && "bg-primary font-semibold text-primary-foreground"
                      )}
                    >
                      {format(day, "d")}
                    </span>
                    <button
                      type="button"
                      onClick={() => onDayClick(day)}
                      className="pointer-events-auto hidden size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 md:flex"
                      aria-label={`Ny avtale ${format(day, "d. MMMM", { locale: nb })}`}
                    >
                      <Plus className="size-3.5" />
                    </button>
                  </div>

                  <div
                    ref={weekIndex === 0 && dayIndex === 0 ? measureRef : undefined}
                    className="pointer-events-none relative z-10 flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden px-1 pb-1"
                  >
                    {visible.map((event) => {
                      const continues = !isSameDay(event.start, day) && event.start < day
                      return (
                        <button
                          key={`${event.id}-${day.toISOString()}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onEventClick(event)
                          }}
                          title={`${format(event.start, "HH:mm")} ${event.title}`}
                          // Mobil: chipsene er for små å treffe — la trykket gå til
                          // dagcellen (som åpner dagsarket). Fra md er chips klikkbare.
                          className="pointer-events-none flex h-5 w-full shrink-0 items-center gap-1 overflow-hidden rounded px-1.5 text-left text-[11px] leading-5 hover:brightness-95 md:pointer-events-auto"
                          style={{
                            backgroundColor: event.backgroundColor ?? "var(--primary)",
                            color: event.textColor ?? "var(--primary-foreground)",
                          }}
                        >
                          {!continues && (
                            <span className="hidden shrink-0 tabular-nums opacity-80 sm:inline">
                              {format(event.start, "HH:mm")}
                            </span>
                          )}
                          <span className="min-w-0 truncate font-medium">
                            {continues ? "↳ " : ""}
                            {event.title || "(Uten tittel)"}
                          </span>
                        </button>
                      )
                    })}
                    {hidden > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          showMore(day)
                        }}
                        className="pointer-events-none h-5 w-full shrink-0 truncate rounded px-1.5 text-left text-[11px] font-medium leading-5 text-muted-foreground hover:bg-muted hover:text-foreground md:pointer-events-auto"
                      >
                        {visible.length === 0 ? (
                          `${hidden} avtaler`
                        ) : (
                          <>
                            +{hidden}
                            <span className="hidden sm:inline"> flere</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
