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
import { useMemo } from "react"
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
}

const WEEKDAY_LABELS = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"]

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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="grid shrink-0 grid-cols-7 border-b border-border">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="border-r border-border px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground last:border-r-0"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid min-h-0 flex-1 grid-cols-7">
            {week.map((day) => {
              const dayEvents = getEventsForDay(events, day)
              const inMonth = isSameMonth(day, date)
              const today = isToday(day)

              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "group relative min-h-0 border-b border-r border-border last:border-r-0",
                    !inMonth && "bg-muted/30",
                    today && "ring-1 ring-inset ring-foreground/40"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onDayClick(day)}
                    className="absolute inset-0 z-0"
                    aria-label={format(day, "d. MMMM yyyy", { locale: nb })}
                  />

                  <div className="pointer-events-none relative z-10 flex h-full min-h-[5rem] flex-col p-1.5 sm:min-h-0">
                    <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                      {dayEvents.slice(0, 3).map((event) => (
                        <button
                          key={`${event.id}-${day.toISOString()}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            onEventClick(event)
                          }}
                          className="pointer-events-auto truncate border px-1.5 py-0.5 text-left text-[11px] leading-tight"
                          style={{
                            backgroundColor: event.backgroundColor ?? "var(--primary)",
                            color: event.textColor ?? "var(--primary-foreground)",
                            borderColor: event.backgroundColor ?? "var(--primary)",
                          }}
                        >
                          {!isSameDay(event.start, day) && event.start < day
                            ? "↳ "
                            : ""}
                          {format(event.start, "HH:mm")} {event.title}
                        </button>
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="px-1 text-[10px] text-muted-foreground">
                          +{dayEvents.length - 3} flere
                        </span>
                      )}
                    </div>

                    <div className="mt-auto flex items-end justify-end gap-1">
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          inMonth ? "text-foreground" : "text-muted-foreground",
                          today && "font-semibold"
                        )}
                      >
                        {format(day, "d")}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onDayClick(day)}
                    className="absolute right-2 top-2 z-20 hidden size-6 items-center justify-center border border-border bg-muted text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-foreground hover:text-background sm:flex"
                    aria-label={`Opprett hendelse ${format(day, "d. MMMM", { locale: nb })}`}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
