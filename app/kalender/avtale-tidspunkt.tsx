"use client"

import { DateTimeField } from "@/components/ui/date-time-field"
import { Label } from "@/components/ui/label"

/** «45 min», «1 t», «1 t 30 min», «2 dager», «1 dag 3 t». Null når slutt ikke er etter start. */
export function formatVarighet(start: Date | null, slutt: Date | null): string | null {
  if (!start || !slutt) return null
  const minutter = Math.round((slutt.getTime() - start.getTime()) / 60_000)
  if (minutter <= 0) return null
  const dager = Math.floor(minutter / (24 * 60))
  const timer = Math.floor((minutter % (24 * 60)) / 60)
  const min = minutter % 60
  const deler = [
    dager > 0 ? `${dager} ${dager === 1 ? "dag" : "dager"}` : null,
    timer > 0 ? `${timer} t` : null,
    min > 0 && dager === 0 ? `${min} min` : null,
  ].filter(Boolean)
  return deler.join(" ")
}

/**
 * Starter og Slutter i avtaledialogene: én rad hver, så datoen får plass
 * («14. okt. 2026») i stedet for å kuttes når de står side om side. Under står
 * hvor lenge avtalen varer, eller at slutt må være etter start.
 */
export function AvtaleTidspunkt({
  idPrefix,
  start,
  slutt,
  onStart,
  onSlutt,
}: {
  idPrefix: string
  start: Date | null
  slutt: Date | null
  onStart: (value: Date | null) => void
  onSlutt: (value: Date | null) => void
}) {
  const varighet = formatVarighet(start, slutt)
  const feil = Boolean(start && slutt && !varighet)
  return (
    <fieldset className="space-y-1.5">
      <legend className="sr-only">Tidspunkt</legend>
      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
        <Label htmlFor={`${idPrefix}-start`} className="text-muted-foreground">
          Starter
        </Label>
        <DateTimeField id={`${idPrefix}-start`} value={start} onChange={onStart} />
        <Label htmlFor={`${idPrefix}-end`} className="text-muted-foreground">
          Slutter
        </Label>
        <DateTimeField id={`${idPrefix}-end`} value={slutt} onChange={onSlutt} />
      </div>
      <p className={feil ? "pl-[4.5rem] text-xs text-destructive" : "pl-[4.5rem] text-xs text-muted-foreground"} aria-live="polite">
        {feil ? "Slutt må være etter start." : varighet ? `Varer ${varighet}` : " "}
      </p>
    </fieldset>
  )
}
