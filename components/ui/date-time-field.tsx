"use client"

import { DatePicker } from "@/components/ui/date-picker"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

function pad(value: number) {
  return String(value).padStart(2, "0")
}

function toDateValue(date: Date | null) {
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` : ""
}

function toTimeValue(date: Date | null) {
  return date ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : ""
}

/** Lokal tid fra «YYYY-MM-DD» + «HH:mm» – `new Date(y, m, d, h, min)` er lokal i alle nettlesere. */
function combine(dateValue: string, timeValue: string): Date | null {
  const [year, month, day] = dateValue.split("-").map(Number)
  const [hour, minute] = (timeValue || "00:00").split(":").map(Number)
  if ([year, month, day, hour, minute].some((part) => Number.isNaN(part))) return null
  return new Date(year, month - 1, day, hour, minute, 0, 0)
}

/**
 * Dato og klokkeslett: repoets DatePicker for datoen og et tidsfelt ved siden av.
 * Erstatter `type="datetime-local"`, som ser ulikt ut i hver nettleser.
 */
export function DateTimeField({
  id,
  value,
  onChange,
  minDate,
  className,
}: {
  id?: string
  value: Date | null
  onChange: (value: Date | null) => void
  minDate?: string
  className?: string
}) {
  const dateValue = toDateValue(value)
  const timeValue = toTimeValue(value)

  return (
    <div className={cn("flex gap-2", className)}>
      <DatePicker
        id={id}
        value={dateValue}
        minDate={minDate}
        className="min-w-0 flex-1"
        onChange={(nextDate) => onChange(nextDate ? combine(nextDate, timeValue || "09:00") : null)}
      />
      <Input
        type="time"
        aria-label="Klokkeslett"
        className="w-28 shrink-0"
        value={timeValue}
        step={300}
        onChange={(event) => {
          if (!event.target.value) return
          onChange(combine(dateValue || toDateValue(new Date()), event.target.value))
        }}
      />
    </div>
  )
}
