"use client"

import * as React from "react"
import { Check, Settings } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"

import {
  DEFAULT_KPI_PERIODS,
  KPI_PERIOD_KEYS,
  resolveKpiPeriod,
  type KpiKey,
  type KpiPeriodKey,
} from "./dashboard-kpi-periods"

/** Hva tallet betyr når det er avgrenset til en periode. */
const METRIC_HINT: Record<KpiKey, string> = {
  omsetning: "Summen av godkjente tilbud i perioden du velger.",
  prosjekter: "Prosjekter som er opprettet i perioden du velger.",
  tilbud: "Tilbud som er sendt i perioden du velger.",
  kunder: "Nye kunder i perioden du velger. «Totalt» viser hele kundelisten.",
}

type DashboardKpiPeriodDialogProps = {
  kpi: KpiKey
  /** Kortets tittel — «Total omsetning», «Prosjekter» … */
  title: string
  value: KpiPeriodKey
  onChange: (period: KpiPeriodKey) => void
  /** Sett samme periode på alle fire kortene. */
  onApplyToAll: (period: KpiPeriodKey) => void
  /** Sant når alle kortene allerede viser `value` — da er «alle kort» overflødig. */
  allMatch: boolean
  className?: string
}

/**
 * Tannhjulet øverst til høyre på et KPI-kort, og dialogen det åpner.
 *
 * Et valg slår inn med en gang — kortet bak oppdaterer seg mens dialogen står
 * åpen, så du ser tallet før du lukker. Ingen «Lagre»-knapp å glemme.
 */
export function DashboardKpiPeriodDialog({
  kpi,
  title,
  value,
  onChange,
  onApplyToAll,
  allMatch,
  className,
}: DashboardKpiPeriodDialogProps) {
  const [open, setOpen] = React.useState(false)
  const optionRefs = React.useRef<Array<HTMLButtonElement | null>>([])

  // Datoene regnes ut på nytt hver gang dialogen åpnes (dashbordet kan ha stått
  // oppe over midnatt), men beholdes mens den lukker seg — ellers kollapser
  // listen midt i lukkeanimasjonen.
  const [options, setOptions] = React.useState(() => KPI_PERIOD_KEYS.map((key) => resolveKpiPeriod(key)))
  const handleOpenChange = (next: boolean) => {
    if (next) setOptions(KPI_PERIOD_KEYS.map((key) => resolveKpiPeriod(key)))
    setOpen(next)
  }
  const selected = options.find((option) => option.key === value)

  // Piltastene flytter valget, slik en radiogruppe skal oppføre seg.
  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0
    if (!step) return
    event.preventDefault()
    const next = (index + step + options.length) % options.length
    onChange(options[next].key)
    optionRefs.current[next]?.focus()
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange}>
      <ResponsiveDialogTrigger asChild>
        <button
          type="button"
          aria-label={`Velg periode for ${title}`}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            className
          )}
        >
          <Settings className="size-4" />
        </button>
      </ResponsiveDialogTrigger>

      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Periode for {title.toLowerCase()}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{METRIC_HINT[kpi]}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex flex-col gap-3 px-4 md:px-0">
          <div role="radiogroup" aria-label="Periode" className="flex flex-col gap-1.5">
            {options.map((option, index) => {
              const isSelected = option.key === value
              return (
                <button
                  key={option.key}
                  ref={(node) => {
                    optionRefs.current[index] = node
                  }}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => onChange(option.key)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                    isSelected
                      ? "border-foreground bg-muted/60"
                      : "border-border hover:border-foreground/30 hover:bg-muted/40"
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {option.label}
                      {option.key === DEFAULT_KPI_PERIODS[kpi] && (
                        <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                          Standard
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {option.rangeText}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      isSelected
                        ? "border-foreground bg-foreground text-background"
                        : "border-muted-foreground/40"
                    )}
                  >
                    {isSelected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Pilen på kortet er bare til hjelp hvis du vet hva den måler mot. */}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {selected?.compare
              ? `Pilen på kortet viser endringen: ${selected.compareText.charAt(0).toLowerCase()}${selected.compareText.slice(1)}.`
              : "Totalen har ingen tidligere periode å måles mot, så kortet viser ingen pil."}
          </p>
        </div>

        <ResponsiveDialogFooter className="md:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={allMatch}
            onClick={() => onApplyToAll(value)}
          >
            {allMatch ? "Gjelder alle kort" : "Bruk på alle kort"}
          </Button>
          <Button type="button" onClick={() => setOpen(false)}>
            Ferdig
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
