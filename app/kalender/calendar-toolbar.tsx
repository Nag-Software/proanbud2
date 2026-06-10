"use client"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { format } from "date-fns"
import { nb } from "date-fns/locale"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
  SlidersHorizontal,
} from "lucide-react"
import { Views } from "react-big-calendar"

export type CalendarView = typeof Views.MONTH | typeof Views.WEEK | typeof Views.DAY

type CalendarToolbarProps = {
  date: Date
  view: CalendarView
  onDateChange: (date: Date) => void
  onViewChange: (view: CalendarView) => void
  onAddEvent: () => void
  timeRange: "work" | "full"
  onTimeRangeChange: (range: "work" | "full") => void
  visibleProvider: "all" | "google" | "microsoft"
  onVisibleProviderChange: (provider: "all" | "google" | "microsoft") => void
  hasBothIntegrations: boolean
  integrations: { provider: string }[]
  onGoogleAuth: () => void
  onOutlookAuth: () => void
  onDisconnect?: (provider: "google" | "microsoft") => void
  isDisconnecting?: boolean
}

const VIEW_LABELS: Record<CalendarView, string> = {
  [Views.MONTH]: "Måned",
  [Views.WEEK]: "Uke",
  [Views.DAY]: "Dag",
}

export function CalendarToolbar({
  date,
  view,
  onDateChange,
  onViewChange,
  onAddEvent,
  timeRange,
  onTimeRangeChange,
  visibleProvider,
  onVisibleProviderChange,
  hasBothIntegrations,
  integrations,
  onGoogleAuth,
  onOutlookAuth,
  onDisconnect,
  isDisconnecting = false,
}: CalendarToolbarProps) {
  const navigate = (direction: -1 | 1) => {
    const next = new Date(date)
    if (view === Views.MONTH) {
      next.setMonth(next.getMonth() + direction)
    } else if (view === Views.WEEK) {
      next.setDate(next.getDate() + direction * 7)
    } else {
      next.setDate(next.getDate() + direction)
    }
    onDateChange(next)
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="rounded-none"
          onClick={() => onDateChange(new Date())}
        >
          I dag
        </Button>

        <Select value={view} onValueChange={(v) => onViewChange(v as CalendarView)}>
          <SelectTrigger className="h-8 w-[110px] rounded-none">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>Visning</SelectLabel>
              <SelectItem value={Views.MONTH}>{VIEW_LABELS[Views.MONTH]}</SelectItem>
              <SelectItem value={Views.WEEK}>{VIEW_LABELS[Views.WEEK]}</SelectItem>
              <SelectItem value={Views.DAY}>{VIEW_LABELS[Views.DAY]}</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-none"
            onClick={() => navigate(-1)}
            aria-label="Forrige periode"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-none"
            onClick={() => navigate(1)}
            aria-label="Neste periode"
          >
            <ChevronRight />
          </Button>
        </div>

        <h2 className="truncate text-sm font-medium capitalize sm:text-base">
          {format(date, "LLLL yyyy", { locale: nb })}
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {hasBothIntegrations && (
          <Select
            value={visibleProvider}
            onValueChange={(v) =>
              onVisibleProviderChange(v as "all" | "google" | "microsoft")
            }
          >
            <SelectTrigger className="hidden h-8 w-[150px] rounded-none md:flex">
              <SlidersHorizontal className="mr-1 size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Kilde</SelectLabel>
                <SelectItem value="all">Alle kalendere</SelectItem>
                <SelectItem value="google">Google</SelectItem>
                <SelectItem value="microsoft">Outlook</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" className="rounded-none" aria-label="Innstillinger">
              <Settings2 />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 rounded-none">
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Visningsperiode
                </p>
                <Select value={timeRange} onValueChange={(v) => onTimeRangeChange(v as "work" | "full")}>
                  <SelectTrigger className="rounded-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="work">Arbeidstid (06:00–18:00)</SelectItem>
                    <SelectItem value="full">Hele døgnet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Kalendere
                </p>
                <div className="flex flex-col gap-2">
                  {!integrations.some((i) => i.provider === "google") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start rounded-none"
                      onClick={onGoogleAuth}
                    >
                      <img
                        src="https://www.gstatic.com/images/branding/product/1x/calendar_48dp.png"
                        alt=""
                        className="size-4"
                      />
                      Koble til Google
                    </Button>
                  )}
                  {!integrations.some((i) => i.provider === "microsoft") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start rounded-none"
                      onClick={onOutlookAuth}
                    >
                      <img
                        src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Microsoft_365_%282022%29.svg/330px-Microsoft_365_%282022%29.svg.png"
                        alt=""
                        className="size-4"
                      />
                      Koble til Outlook
                    </Button>
                  )}
                  {integrations.some((i) => i.provider === "google") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start rounded-none"
                      disabled={isDisconnecting}
                      onClick={() => onDisconnect?.("google")}
                    >
                      Koble fra Google
                    </Button>
                  )}
                  {integrations.some((i) => i.provider === "microsoft") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start rounded-none"
                      disabled={isDisconnecting}
                      onClick={() => onDisconnect?.("microsoft")}
                    >
                      Koble fra Outlook
                    </Button>
                  )}
                  {integrations.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {integrations.map((i) => (i.provider === "google" ? "Google" : "Outlook")).join(" · ")} er tilkoblet.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </PopoverContent>
        </Popover>

        <Button size="sm" className="rounded-none" onClick={onAddEvent}>
          <Plus />
          <span className="hidden sm:inline">Ny hendelse</span>
        </Button>
      </div>
    </div>
  )
}
