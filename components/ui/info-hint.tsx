"use client"

/**
 * Forklaringen bak en (i).
 *
 * Små, grå hjelpetekster under hvert felt gjør skjermbilder travle: de tar plass
 * hele tiden, men leses én gang. Her ligger forklaringen bak et ikon i stedet —
 * synlig for den som lurer, usynlig for den som har skjønt det.
 *
 * Bruker ResponsiveDialog, så det blir et bunnark på mobil og en liten dialog på
 * desktop — samme mønster som resten av appen.
 */

import * as React from "react"
import { Info } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog"

export function InfoHint({
  title,
  children,
  className,
  label,
}: {
  /** Overskriften i dialogen — som regel navnet på tallet eller feltet. */
  title: string
  children: React.ReactNode
  className?: string
  /** Skjermleser-tekst. Faller tilbake på tittelen. */
  label?: string
}) {
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger asChild>
        <button
          type="button"
          aria-label={label ?? `Forklaring: ${title}`}
          className={cn(
            // Ikonet er 14px, men trykkflaten er 24px — ellers er den umulig å
            // treffe med en arbeidshanske på.
            "inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className
          )}
        >
          <Info className="size-3.5" />
        </button>
      </ResponsiveDialogTrigger>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription asChild>
            <div className="space-y-2 text-left text-sm text-muted-foreground">{children}</div>
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
