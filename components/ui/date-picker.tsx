"use client"

import { format, parse } from "date-fns"
import { nb } from "date-fns/locale"
import { CalendarDays } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type DatePickerProps = {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

function parseDateValue(value?: string): Date | undefined {
  if (!value) return undefined
  const parsed = parse(value, "yyyy-MM-dd", new Date())
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Velg dato",
  className,
}: DatePickerProps) {
  const selected = parseDateValue(value)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            "h-8 w-fit justify-between gap-1.5 rounded-lg px-2.5 text-sm font-normal",
            !selected && "text-muted-foreground",
            className
          )}
        >
          {selected ? format(selected, "d. MMM yyyy", { locale: nb }) : placeholder}
          <CalendarDays className="size-4 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => onChange(date ? format(date, "yyyy-MM-dd") : "")}
          locale={nb}
        />
      </PopoverContent>
    </Popover>
  )
}
