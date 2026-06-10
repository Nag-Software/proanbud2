"use client"

import { format, isSameDay } from "date-fns"
import { nb } from "date-fns/locale"
import { CalendarDays, X } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { countDaysInRange } from "@/lib/time-tracking"
import { cn } from "@/lib/utils"

type DayFilterPickerProps = {
  selectedRange: DateRange | undefined
  onSelectedRangeChange: (range: DateRange | undefined) => void
  daysWithEntries?: Record<string, { id?: string }[]>
}

function formatRangeLabel(range: DateRange | undefined): string {
  if (!range?.from) return "Alle dager"

  if (!range.to || isSameDay(range.from, range.to)) {
    return format(range.from, "d. MMM yyyy", { locale: nb })
  }

  const dayCount = countDaysInRange(range)
  return `${format(range.from, "d. MMM", { locale: nb })} – ${format(range.to, "d. MMM yyyy", { locale: nb })} (${dayCount} dager)`
}

export function DayFilterPicker({
  selectedRange,
  onSelectedRangeChange,
  daysWithEntries,
}: DayFilterPickerProps) {
  const hasFilter = Boolean(selectedRange?.from)
  const label = formatRangeLabel(selectedRange)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn("gap-2", hasFilter && "border-primary/50 bg-primary/5")}
          >
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <div className="space-y-2 p-3">
            <p className="text-xs text-muted-foreground">
              Velg start- og sluttdato. Alle dager i perioden inkluderes automatisk. Dager med
              registrerte timer er markert.
            </p>
            <Calendar
              mode="range"
              selected={selectedRange}
              onSelect={onSelectedRangeChange}
              locale={nb}
              tasksByDate={daysWithEntries}
            />
          </div>
        </PopoverContent>
      </Popover>

      {hasFilter && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1 text-muted-foreground"
          onClick={() => onSelectedRangeChange(undefined)}
        >
          <X className="h-4 w-4" />
          Nullstill filter
        </Button>
      )}
    </div>
  )
}
