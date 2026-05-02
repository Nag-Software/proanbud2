"use client"

import { format } from "date-fns"
import { nb } from "date-fns/locale"
import { CalendarDays } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type DatePickerFieldProps = {
  label: string
  value?: Date
  onChange: (date?: Date) => void
  error?: string
}

export function DatePickerField({ label, value, onChange, error }: DatePickerFieldProps) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{label}</p>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "h-12 w-full justify-between rounded-lg px-4 text-left text-base",
              !value && "text-muted-foreground",
              error && "border-destructive"
            )}
          >
            {value ? format(value, "PPP", { locale: nb }) : "Velg dato"}
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={value}
            onSelect={(date) => onChange(date ?? undefined)}
            locale={nb}
          />
        </PopoverContent>
      </Popover>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
