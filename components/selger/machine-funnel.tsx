"use client"

// Traktstripen for maskinstegene, over kanban.
//
// Kanban viser bare menneskestegene — Varm, Dialog, Demo, Prøve, Vunnet/Tapt —
// fordi det er de Casper faktisk flytter noe imellom. Maskinstegene er ikke
// kolonner han skal dra kort mellom; de er en tilstand han trenger å kunne
// lese av. Derfor en stripe, ikke et brett.
//
// Hvert tall er en lenke inn i prospektlisten, filtrert på det steget. En
// trakt man ikke kan klikke seg inn i er bare et tall.

import Link from "next/link"
import { cn } from "@/lib/utils"
import type { MachineFunnel } from "@/lib/selger/godkjenning"

const STEPS: Array<{ key: keyof MachineFunnel; label: string }> = [
  { key: "kilde", label: "Kilde" },
  { key: "venter_research", label: "Venter research" },
  { key: "kvalifisert", label: "Kvalifisert" },
  { key: "til_godkjenning", label: "Til godkjenning" },
  { key: "i_sekvens", label: "I sekvens" },
  { key: "avsluttet", label: "Avsluttet" },
]

const SIDE: Array<{ key: keyof MachineFunnel; label: string; hint: string }> = [
  { key: "for_tynn", label: "For tynn", hint: "Ingen validert krok — ingen e-post skrives" },
  { key: "kun_telefon", label: "Kun telefon", hint: "Ingen lovlig e-postkanal" },
  { key: "diskvalifisert", label: "Ute", hint: "Utenfor målgruppen" },
]

export function MachineFunnelStrip({ funnel }: { funnel: MachineFunnel }) {
  const total = STEPS.reduce((sum, step) => sum + funnel[step.key], 0)

  return (
    <div className="flex flex-wrap items-stretch gap-1 border-b px-3 py-2 text-xs">
      {STEPS.map((step, index) => {
        const count = funnel[step.key]
        const share = total > 0 ? count / total : 0
        return (
          <Link
            key={step.key}
            href={`/selger/leads?steg=${step.key}`}
            className={cn(
              "group flex min-w-[104px] flex-1 flex-col gap-0.5 border px-2.5 py-1.5 transition-colors hover:bg-muted/60",
              count === 0 && "opacity-55",
              step.key === "til_godkjenning" && count > 0 && "border-foreground/40",
            )}
            title={`${count} prospekter på steget «${step.label}»`}
          >
            <span className="text-muted-foreground">{step.label}</span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-base font-semibold tabular-nums">{count}</span>
              {index > 0 && total > 0 && (
                <span className="text-[10px] text-muted-foreground">
                  {Math.round(share * 100)} %
                </span>
              )}
            </span>
          </Link>
        )
      })}

      <div className="flex min-w-[150px] flex-col justify-center gap-0.5 border border-dashed px-2.5 py-1.5 text-[11px] text-muted-foreground">
        {SIDE.map((item) => (
          <Link
            key={item.key}
            href={`/selger/leads?steg=${item.key}`}
            className="hover:underline"
            title={item.hint}
          >
            {item.label} {funnel[item.key]}
          </Link>
        ))}
      </div>
    </div>
  )
}
