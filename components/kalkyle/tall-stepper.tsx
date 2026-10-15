"use client"

import { MinusIcon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type TallStepperProps = {
  /** Brukes i aria-label på knappene («Senk timepris»). */
  label: string
  verdi: number
  steg: number
  min?: number
  max?: number
  /** Teksten som vises, f.eks. «750 kr/t». */
  visning: string
  onChange: (verdi: number) => void
  stor?: boolean
  className?: string
}

/** −/+ med ekte knapper (44 px med finger, kompakt med mus). Verdien leses opp når den endres. */
export function TallStepper({ label, verdi, steg, min = 0, max, visning, onChange, stor, className }: TallStepperProps) {
  const klem = (v: number) => Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min, Math.round(v * 100) / 100))
  const knapp = stor ? "size-12" : "size-9 pointer-coarse:size-11"
  return (
    <div className={cn("inline-flex items-center rounded-[var(--radius-control)] border bg-background", className)}>
      <Button
        type="button"
        variant="ghost"
        className={cn(knapp, "rounded-r-none")}
        aria-label={`Senk ${label.toLowerCase()}`}
        disabled={verdi <= min}
        onClick={() => onChange(klem(verdi - steg))}
      >
        <MinusIcon className="size-4" />
      </Button>
      <output
        aria-live="polite"
        className={cn("text-center font-semibold tabular-nums", stor ? "min-w-24 text-lg" : "min-w-16 text-sm")}
      >
        {visning}
      </output>
      <Button
        type="button"
        variant="ghost"
        className={cn(knapp, "rounded-l-none")}
        aria-label={`Øk ${label.toLowerCase()}`}
        disabled={max !== undefined && verdi >= max}
        onClick={() => onChange(klem(verdi + steg))}
      >
        <PlusIcon className="size-4" />
      </Button>
    </div>
  )
}
