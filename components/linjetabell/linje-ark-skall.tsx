"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

/**
 * Felles ark for å redigere én linje (kalkyle og tilbud): fra høyre på PC,
 * nedenfra på mobil. Kompakt, så hele linja ses på én gang: små felt i to
 * kolonner og summen på én linje nederst.
 */
export function LinjeArkSkall({
  open,
  onLukk,
  tittel,
  prikk,
  undertittel,
  sum,
  onSlett,
  onAvbryt,
  children,
  onOpenAutoFocus,
}: {
  open: boolean
  onLukk: () => void
  tittel: string
  prikk?: string
  undertittel?: string
  /** «Kunden betaler» og (valgfritt) «Din kostnad», ferdig formatert. */
  sum: { kunden: string; kost?: string; merknad?: string }
  onSlett: () => void
  /** Forkaster alt som er endret siden arket ble åpnet, og lukker. */
  onAvbryt?: () => void
  children: React.ReactNode
  onOpenAutoFocus?: (e: Event) => void
}) {
  const isMobile = useIsMobile()
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onLukk()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        onOpenAutoFocus={onOpenAutoFocus}
        className={cn("gap-0 p-0", isMobile ? "max-h-[92dvh] rounded-t-2xl" : "w-full sm:max-w-[380px]")}
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="flex items-center gap-2 text-[15px]">
            {prikk && <span aria-hidden className={cn("size-2 rounded-full", prikk)} />}
            {tittel}
          </SheetTitle>
          {undertittel && <SheetDescription className="text-xs">{undertittel}</SheetDescription>}
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">{children}</div>

        <div className="border-t bg-muted/30 px-4 py-2.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span>Kunden betaler</span>
            <strong className="tabular-nums">{sum.kunden}</strong>
          </div>
          {sum.kost && (
            <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
              <span>Din kostnad</span>
              <span className="tabular-nums">{sum.kost}</span>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{sum.merknad ?? "Eks. mva"}</p>
        </div>

        <SheetFooter className="flex-row gap-2 border-t px-4 py-2.5">
          <Button type="button" variant="ghost" className="text-destructive pointer-coarse:h-11" onClick={onSlett}>
            Slett linje
          </Button>
          {onAvbryt && (
            <Button type="button" variant="outline" className="ml-auto pointer-coarse:h-11" onClick={onAvbryt}>
              Avbryt
            </Button>
          )}
          <Button type="button" className="flex-1 pointer-coarse:h-11" onClick={onLukk}>
            Ferdig
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** Et felt i arket: liten etikett over, valgfri hjelpetekst under. */
export function ArkFelt({
  label,
  htmlFor,
  hjelp,
  className,
  children,
}: {
  label: string
  htmlFor?: string
  hjelp?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </label>
      {children}
      {hjelp && <div className="text-xs text-muted-foreground">{hjelp}</div>}
    </div>
  )
}

/** Klassen for felt i arket: 36 px (44 px på berøringsskjerm). */
export const arkInput =
  "h-9 w-full min-w-0 rounded-md border bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/20 pointer-coarse:h-11 pointer-coarse:text-base"

/** Felt med «kr» eller «%» til høyre. */
export function ArkTall({
  id,
  value,
  onChange,
  suffix,
  autoFocus,
}: {
  id: string
  value: string
  onChange: (tekst: string) => void
  suffix?: string
  autoFocus?: boolean
}) {
  return (
    <div className="relative">
      <input
        id={id}
        inputMode="decimal"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        className={cn(arkInput, "tabular-nums", suffix && "pr-8")}
      />
      {suffix && (
        <span aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">
          {suffix}
        </span>
      )}
    </div>
  )
}

/** Små valgknapper på én rad (type, vanlige enheter). */
export function ArkValg<T extends string>({
  label,
  valg,
  value,
  onChange,
}: {
  label: string
  valg: Array<{ verdi: T; navn: string; prikk?: string }>
  value: T | null
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {valg.map((v) => {
        const aktiv = v.verdi === value
        return (
          <button
            key={v.verdi}
            type="button"
            aria-pressed={aktiv}
            onClick={() => !aktiv && onChange(v.verdi)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:h-10",
              aktiv ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted/60"
            )}
          >
            {v.prikk && <span aria-hidden className={cn("size-1.5 rounded-full", v.prikk, aktiv && "ring-1 ring-background")} />}
            {v.navn}
          </button>
        )
      })}
    </div>
  )
}
