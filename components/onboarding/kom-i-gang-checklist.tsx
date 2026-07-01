"use client"

// Kom-i-gang-sjekkliste på dashbordet: de fire første stegene en ny bedrift
// bør gjøre. Kortet skjules automatisk når alle steg er fullført, og kan
// skjules manuelt — valget huskes per bedrift i localStorage.

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, CheckCircle2, Circle, X } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export interface KomIGangStep {
  key: string
  label: string
  href: string
  done: boolean
}

interface KomIGangChecklistProps {
  steps: KomIGangStep[]
  companyId: string
}

export function KomIGangChecklist({ steps, companyId }: KomIGangChecklistProps) {
  const storageKey = `proanbud-kom-i-gang-skjult-${companyId}`
  // Komponenten mountes først etter at dashbordet har lastet dataene sine
  // (ren klientside), så vi kan lese localStorage direkte i initializeren —
  // kortet blinker aldri frem for noen som allerede har skjult det.
  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    try {
      return window.localStorage.getItem(storageKey) === "1"
    } catch {
      return false
    }
  })

  const doneCount = steps.filter((s) => s.done).length
  const allDone = steps.length > 0 && doneCount === steps.length

  if (dismissed || allDone) return null

  const hide = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(storageKey, "1")
    } catch {
      // localStorage utilgjengelig (f.eks. privat modus) — skjul kun for økten.
    }
  }

  return (
    <Card className="bg-card/85">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
          Kom i gang
        </CardTitle>
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            {doneCount} av {steps.length} fullført
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="h-6 w-6 -mr-1 text-muted-foreground hover:text-foreground"
            onClick={hide}
          >
            <X className="h-3.5 w-3.5" />
            <span className="sr-only">Skjul</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="h-1 w-full overflow-hidden bg-muted">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.round((doneCount / steps.length) * 100)}%` }}
          />
        </div>
        <div className="mt-1 divide-y divide-border/50">
          {steps.map((step) =>
            step.done ? (
              <div key={step.key} className="flex items-center gap-3 py-2.5">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" strokeWidth={1.8} />
                <span className="text-xs text-muted-foreground line-through decoration-muted-foreground/40">
                  {step.label}
                </span>
              </div>
            ) : (
              <Link
                key={step.key}
                href={step.href}
                className="group flex items-center gap-3 py-2.5 transition-colors hover:bg-muted/30"
              >
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" strokeWidth={1.8} />
                <span className="flex-1 text-xs font-medium text-foreground">{step.label}</span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" />
              </Link>
            )
          )}
        </div>
      </CardContent>
    </Card>
  )
}
