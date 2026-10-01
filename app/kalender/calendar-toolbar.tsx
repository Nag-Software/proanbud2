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
import { endOfWeek, format, isSameMonth, isSameYear, startOfWeek } from "date-fns"
import { nb } from "date-fns/locale"
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings2,
  SlidersHorizontal,
} from "lucide-react"
import { cn } from "@/lib/utils"

// String literals instead of importing `Views` from react-big-calendar — that
// import alone would pull the (non-tree-shakeable) library into the toolbar's
// bundle, defeating the lazy-loading of the calendar grid. These are the exact
// runtime values of Views.MONTH/WEEK/DAY.
export type CalendarView = "month" | "week" | "day"

export type CalendarSource = "all" | "proanbud" | "google" | "microsoft"

type CalendarToolbarProps = {
  date: Date
  view: CalendarView
  onDateChange: (date: Date) => void
  onViewChange: (view: CalendarView) => void
  onAddEvent: () => void
  timeRange: "work" | "full"
  onTimeRangeChange: (range: "work" | "full") => void
  visibleProvider: CalendarSource
  onVisibleProviderChange: (provider: CalendarSource) => void
  integrations: { provider: string }[]
  onGoogleAuth: () => void
  onOutlookAuth: () => void
  onDisconnect?: (provider: "google" | "microsoft") => void
  isDisconnecting?: boolean
}

const VIEW_LABELS: Record<CalendarView, string> = {
  month: "Måned",
  week: "Uke",
  day: "Dag",
}

/** Tittelen følger visningen: «Oktober 2026», «19.–25. okt. 2026», «28. sep. – 4. okt. 2026», «1. oktober 2026». */
function periodLabel(date: Date, view: CalendarView) {
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
  // Ukedagen står allerede i kolonneoverskriften — tittelen holdes kort.
  if (view === "day") return format(date, "d. MMMM yyyy", { locale: nb })
  if (view === "week") {
    const start = startOfWeek(date, { weekStartsOn: 1 })
    const end = endOfWeek(date, { weekStartsOn: 1 })
    if (isSameMonth(start, end)) {
      return `${format(start, "d.")}–${format(end, "d. MMM yyyy", { locale: nb })}`
    }
    const startFmt = isSameYear(start, end) ? "d. MMM" : "d. MMM yyyy"
    return `${format(start, startFmt, { locale: nb })} – ${format(end, "d. MMM yyyy", { locale: nb })}`
  }
  return cap(format(date, "LLLL yyyy", { locale: nb }))
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
  integrations,
  onGoogleAuth,
  onOutlookAuth,
  onDisconnect,
  isDisconnecting = false,
}: CalendarToolbarProps) {
  // Kildefilteret gir bare mening når minst én ekstern kalender er tilkoblet —
  // uten tilkobling finnes kun Proanbud-avtaler.
  const hasGoogle = integrations.some((i) => i.provider === "google")
  const hasMicrosoft = integrations.some((i) => i.provider === "microsoft")
  const showSourceFilter = hasGoogle || hasMicrosoft

  const navigate = (direction: -1 | 1) => {
    const next = new Date(date)
    if (view === "month") {
      next.setMonth(next.getMonth() + direction)
    } else if (view === "week") {
      next.setDate(next.getDate() + direction * 7)
    } else {
      next.setDate(next.getDate() + direction)
    }
    onDateChange(next)
  }

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-2 md:px-4">
      <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onDateChange(new Date())}
        >
          I dag
        </Button>

        <div className="flex shrink-0 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(-1)}
            aria-label="Forrige periode"
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => navigate(1)}
            aria-label="Neste periode"
          >
            <ChevronRight />
          </Button>
        </div>

        <h2 className="min-w-0 truncate text-sm font-medium sm:text-base">
          {periodLabel(date, view)}
        </h2>
        {view !== "month" && (
          <span className="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground lg:inline">
            Uke {format(date, "I")}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
        {/* Mobil tvinges til månedsvisning (se KalenderPage-effekten) — velgeren er kun støy der. */}
        <div
          role="group"
          aria-label="Visning"
          className="hidden items-center gap-0.5 rounded-lg border border-border/60 bg-card p-0.5 md:inline-flex"
        >
          {(["month", "week", "day"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => onViewChange(v)}
              aria-pressed={view === v}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                view === v
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
              )}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>

        {showSourceFilter && (
          <Select
            value={visibleProvider}
            onValueChange={(v) => onVisibleProviderChange(v as CalendarSource)}
          >
            <SelectTrigger className="hidden h-8 w-[150px] xl:flex">
              <SlidersHorizontal className="mr-1 size-3.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Kilde</SelectLabel>
                <SelectItem value="all">Alle kalendere</SelectItem>
                <SelectItem value="proanbud">Proanbud</SelectItem>
                {hasGoogle && <SelectItem value="google">Google</SelectItem>}
                {hasMicrosoft && <SelectItem value="microsoft">Outlook</SelectItem>}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Innstillinger">
              <Settings2 />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <div className="space-y-4">
              {showSourceFilter && (
                <div className="space-y-2 xl:hidden">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Kalenderkilde
                  </p>
                  <Select
                    value={visibleProvider}
                    onValueChange={(v) => onVisibleProviderChange(v as CalendarSource)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Alle kalendere</SelectItem>
                      <SelectItem value="proanbud">Proanbud</SelectItem>
                      {hasGoogle && <SelectItem value="google">Google</SelectItem>}
                      {hasMicrosoft && <SelectItem value="microsoft">Outlook</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Visningsperiode
                </p>
                <Select value={timeRange} onValueChange={(v) => onTimeRangeChange(v as "work" | "full")}>
                  <SelectTrigger>
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
                      className="justify-start"
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
                      className="justify-start"
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
                      className="justify-start font-bold"
                      disabled={isDisconnecting}
                      onClick={() => onDisconnect?.("google")}
                    >
                      <img
                        src="https://www.gstatic.com/images/branding/product/1x/calendar_48dp.png"
                        alt=""
                        className="size-4"
                      />
                      Koble fra Google
                    </Button>
                  )}
                  {integrations.some((i) => i.provider === "microsoft") && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start font-bold"
                      disabled={isDisconnecting}
                      onClick={() => onDisconnect?.("microsoft")}
                    >
                      <img
                        src="https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Microsoft_365_%282022%29.svg/330px-Microsoft_365_%282022%29.svg.png"
                        alt=""
                        className="size-4"
                      />

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

        <Button size="sm" onClick={onAddEvent}>
          <Plus />
          <span className="hidden sm:inline">Ny avtale</span>
        </Button>
      </div>
    </div>
  )
}
