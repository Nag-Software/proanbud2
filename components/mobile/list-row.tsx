"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

type MobileListRowProps = {
  /** Gjør hele raden til en lenke. Utelates den blir raden et vanlig <div>. */
  href?: string
  /** 40 px kvadrat til venstre — miniatyrbilde, ikon eller initialer. */
  leading?: ReactNode
  title: ReactNode
  /** Andre linje: adresse, kunde, dato … Kuttes med ellipse. */
  subtitle?: ReactNode
  /** Tredje linje, minst vekt. Vises bare når det faktisk er plass til den. */
  meta?: ReactNode
  /** Høyre side: beløp, antall, badge. */
  trailing?: ReactNode
  /**
   * Meny-/handlingsknapp helt til høyre. Ligger utenfor lenka så et trykk på
   * den ikke navigerer — derfor er raden en <div> med lenka som overlegg når
   * både `href` og `action` er satt.
   */
  action?: ReactNode
  /** Farget skinne i venstrekanten — brukes til status. */
  accentClassName?: string
  className?: string
}

/**
 * Én rad i en mobilliste: 40 px medie til venstre, to–tre tekstlinjer, verdi
 * til høyre. Ca. 64 px høy, altså ti rader på en telefon der de gamle kortene
 * ga halvannet.
 *
 * Hele raden er treffbar (min. 56 px), og lenka legges som et overlegg slik at
 * en meny-knapp til høyre kan trykkes uten å navigere.
 */
export function MobileListRow({
  href,
  leading,
  title,
  subtitle,
  meta,
  trailing,
  action,
  accentClassName,
  className,
}: MobileListRowProps) {
  const body = (
    <>
      {accentClassName && (
        <span
          aria-hidden
          className={cn("absolute inset-y-0 left-0 w-[3px] rounded-r-full", accentClassName)}
        />
      )}

      {leading && (
        <span className="relative z-10 flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground">
          {leading}
        </span>
      )}

      <span className="relative z-10 flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-sm font-semibold leading-snug text-foreground">{title}</span>
        {subtitle && (
          <span className="truncate text-xs leading-snug text-muted-foreground">{subtitle}</span>
        )}
        {meta && <span className="truncate text-xs leading-snug text-muted-foreground/80">{meta}</span>}
      </span>

      {trailing && (
        <span className="relative z-10 flex shrink-0 flex-col items-end gap-0.5 text-right">
          {trailing}
        </span>
      )}
    </>
  )

  const shell = cn(
    "relative flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors active:bg-muted/60",
    className
  )

  // Uten egen handlingsknapp er raden bare en lenke — enklest og mest robust.
  if (href && !action) {
    return (
      <Link href={href} className={shell}>
        {body}
      </Link>
    )
  }

  return (
    <div className={shell}>
      {href && (
        <Link href={href} className="absolute inset-0 z-0" aria-label={undefined}>
          <span className="sr-only">{typeof title === "string" ? title : "Åpne"}</span>
        </Link>
      )}
      {body}
      {action && <span className="relative z-10 shrink-0">{action}</span>}
    </div>
  )
}

/** Beholder som gir listeradene skille-streker og en kortflate rundt. */
export function MobileList({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "divide-y divide-border/60 overflow-hidden rounded-lg border border-border/60 bg-card",
        className
      )}
    >
      {children}
    </div>
  )
}
