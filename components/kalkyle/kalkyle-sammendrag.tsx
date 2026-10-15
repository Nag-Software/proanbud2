"use client"

import * as React from "react"
import { ArrowRightIcon, LockIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { formatAntall, formatKr, formatProsent } from "@/lib/kalkyle/format"
import { cn } from "@/lib/utils"
import { useKalkyle } from "./kalkyle-provider"

/** Under denne dekningsgraden vises marginen i oransje. */
export const GOD_DEKNINGSGRAD = 0.2

export function DekningsgradMerke({ dekningsgrad, className }: { dekningsgrad: number; className?: string }) {
  const god = dekningsgrad >= GOD_DEKNINGSGRAD
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-px text-xs font-semibold tabular-nums",
        god
          ? "border-[#d7e8bf] bg-[color:var(--surface-success)] text-[#4d7219]"
          : "border-[#f0dcb4] bg-[color:var(--surface-warning)] text-[#8a5f1b]",
        className
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", god ? "bg-[#5d8720]" : "bg-amber-600")} />
      {formatProsent(dekningsgrad)} margin
    </span>
  )
}

/** Ett tall som betyr noe: hva kunden betaler. Resten ligger bak «Vis detaljer». */
export function KalkyleSammendrag({ onLagTilbud }: { onLagTilbud: () => void }) {
  const { resultat } = useKalkyle()
  const [detaljer, setDetaljer] = React.useState(false)
  const detaljId = React.useId()
  if (!resultat) return null
  const t = resultat.totalt

  return (
    <div className="flex flex-col gap-2">
      <section aria-label="Sammendrag" className="rounded-lg border bg-card p-3.5 shadow-[var(--shadow-surface)]">
        <p className="text-xs text-muted-foreground">Kunden betaler</p>
        <p className="text-2xl font-bold leading-tight tracking-tight tabular-nums">{formatKr(t.inklMva)}</p>
        <p className="text-xs text-muted-foreground">inkl. mva</p>

        <div className="mt-3 border-t pt-2.5">
          <p className="text-xs text-muted-foreground">Du sitter igjen med</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2.5">
            <span className="text-base font-bold tabular-nums">{formatKr(t.fortjeneste)}</span>
            <DekningsgradMerke dekningsgrad={t.dekningsgrad} />
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground tabular-nums">{formatAntall(t.timer)} timer arbeid</p>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1.5 px-0.5 underline underline-offset-4"
          aria-expanded={detaljer}
          aria-controls={detaljId}
          onClick={() => setDetaljer((v) => !v)}
        >
          {detaljer ? "Skjul detaljer" : "Vis detaljer"}
        </Button>
        {detaljer && (
          <dl id={detaljId} className="mt-1 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="text-muted-foreground">Din kostnad</dt>
            <dd className="text-right tabular-nums">{formatKr(t.kost)}</dd>
            <dt className="text-muted-foreground">Pris eks. mva</dt>
            <dd className="text-right tabular-nums">{formatKr(t.salgEksMva)}</dd>
            <dt className="text-muted-foreground">Mva 25 %</dt>
            <dd className="text-right tabular-nums">{formatKr(t.mva)}</dd>
          </dl>
        )}

        <p className="mt-2.5 flex items-start gap-2 text-xs text-muted-foreground">
          <LockIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Kunden ser aldri innpris, påslag eller fortjeneste.
        </p>
      </section>

      <Button type="button" className="w-full" onClick={onLagTilbud}>
        Lag tilbud fra kalkylen
        <ArrowRightIcon aria-hidden />
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => toast.info("Lagring av maler kommer når kalkylen kobles til databasen.")}
      >
        Lagre som mal
      </Button>
    </div>
  )
}
