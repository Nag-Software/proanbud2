"use client"

import * as React from "react"
import Link from "next/link"
import { SearchIcon } from "lucide-react"

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { formatAntall, formatKr } from "@/lib/kalkyle/format"
import type { LagretJobb } from "@/lib/kalkyle/types"
import { useMinePriser } from "./mine-priser-kontekst"

type LagretJobbVelgerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Posten jobben legges i, for teksten øverst. */
  postNavn: string
  onVelg: (jobb: LagretJobb) => void
}

/** «+ Fast jobb»: velg en lagret fastprisjobb, samme dialog som i tilbudsgeneratoren. */
export function LagretJobbVelger({ open, onOpenChange, postNavn, onVelg }: LagretJobbVelgerProps) {
  const { lagredeJobber, kilde } = useMinePriser()
  const [sok, setSok] = React.useState("")
  const q = sok.trim().toLowerCase()
  const treff = q ? lagredeJobber.filter((j) => j.navn.toLowerCase().includes(q)) : lagredeJobber

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setSok("")
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 border-b px-4 py-4 text-left">
          <DialogTitle>Legg til fast jobb</DialogTitle>
          <DialogDescription>Velg en lagret fastprisjobb. Den legges inn under «{postNavn}».</DialogDescription>
        </DialogHeader>

        <div className="border-b px-4 py-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              aria-label="Søk i lagrede jobber"
              value={sok}
              onChange={(e) => setSok(e.target.value)}
              placeholder="Søk på jobbnavn …"
              className="pl-9"
            />
          </div>
          {kilde.jobber === "eksempel" && (
            <p className="mt-2 text-xs text-muted-foreground">
              Dette er eksempler. Legg inn bedriftens egne under{" "}
              <Link href="/mine-priser/lagrede-jobber" className="font-medium text-foreground underline underline-offset-2">
                Mine priser → Lagrede jobber
              </Link>
              .
            </p>
          )}
        </div>

        <div className="max-h-[min(420px,50vh)] overflow-y-auto p-2">
          {treff.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Ingen lagrede jobber passer «{sok.trim()}».</p>
          ) : (
            <ul className="space-y-1">
              {treff.map((jobb) => (
                <li key={jobb.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onVelg(jobb)
                      onOpenChange(false)
                      setSok("")
                    }}
                    className="flex min-h-11 w-full items-start justify-between gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{jobb.navn}</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {jobb.timer ? `Fastpris · ${formatAntall(jobb.timer)} t` : "Fastpris · timer ikke satt"}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums">{formatKr(jobb.pris)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
