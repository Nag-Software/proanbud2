"use client"

import { useId, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

type NumFieldProps = {
  label: string
  value: number
  onChange: (n: number) => void
  suffix?: string
  min?: number
  max?: number
  hint?: string
  className?: string
}

/**
 * Tallfelt for kalkulatorene. Holder egen tekst-tilstand så norsk komma og
 * fri redigering funker; sender et klemt tall opp ved hver endring.
 */
export function NumField({ label, value, onChange, suffix, min = 0, max, hint, className }: NumFieldProps) {
  const id = useId()
  const [text, setText] = useState(() => (value ? String(value) : ""))

  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            const raw = e.target.value.replace(/\s/g, "")
            setText(raw)
            if (raw === "" || raw === "-" || raw === ",") {
              onChange(0)
              return
            }
            const n = Number(raw.replace(",", "."))
            if (Number.isNaN(n)) return
            let v = n
            if (v < min) v = min
            if (max != null && v > max) v = max
            onChange(v)
          }}
          onBlur={() => {
            // Normaliser visningen etter redigering (fjern ledende null osv.).
            setText(value ? String(value) : "")
          }}
          className={cn("h-11 text-base", suffix && "pr-14")}
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}

/** To valg som segment-bytter (f.eks. «Jeg vet påslaget» / «… ønsket margin»). */
export function SegToggle<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <div className="inline-flex rounded-lg border bg-muted/50 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === o.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Stor, uthevet hovedverdi i resultatet. */
export function ResultHero({ value, caption, sub }: { value: string; caption: string; sub?: string }) {
  return (
    <div className="text-center">
      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">{caption}</p>
      <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">{value}</p>
      {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
    </div>
  )
}

/** Rad i en resultat-oppstilling: etikett venstre, verdi høyre. */
export function StatRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string
  value: string
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-2",
        strong && "border-t font-semibold",
        muted && "text-muted-foreground"
      )}
    >
      <span className={cn("text-sm", !muted && "text-foreground")}>{label}</span>
      <span className={cn("tabular-nums", strong ? "text-base" : "text-sm")}>{value}</span>
    </div>
  )
}
