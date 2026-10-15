"use client"

import * as React from "react"
import Link from "next/link"
import { Loader2Icon, PlusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { reportClientError } from "@/lib/errors/client"
import { formatKr } from "@/lib/kalkyle/format"
import type { SearchMaterial } from "@/lib/tilbud/company-price-utils"

type SokStatus = "laster" | "ferdig" | "feil"

/**
 * Søk i bedriftens prislister (samme endepunkt som «Legg til fra prisliste» i
 * tilbudsgeneratoren). Uten søkeord vises de første varene.
 */
export function usePrislisteSok(sok: string, aktiv: boolean) {
  const sokeord = useDebouncedValue(sok, 250)
  const [varer, setVarer] = React.useState<SearchMaterial[]>([])
  const [status, setStatus] = React.useState<SokStatus>("laster")

  React.useEffect(() => {
    if (!aktiv) return
    let avbrutt = false
    setStatus("laster")
    void (async () => {
      try {
        const params = new URLSearchParams({ type: "material", limit: "20" })
        if (sokeord.trim()) params.set("q", sokeord.trim())
        const res = await fetch(`/api/mine-priser/sok?${params.toString()}`)
        const data = (await res.json().catch(() => ({}))) as { materials?: SearchMaterial[]; error?: string }
        if (!res.ok) throw new Error(data.error || "Kunne ikke søke i prislisten")
        if (!avbrutt) {
          setVarer(data.materials ?? [])
          setStatus("ferdig")
        }
      } catch (error) {
        reportClientError(error, { level: "warning", context: { action: "kalkyle: søk i prisliste" } })
        if (!avbrutt) {
          setVarer([])
          setStatus("feil")
        }
      }
    })()
    return () => {
      avbrutt = true
    }
  }, [sokeord, aktiv])

  return { varer, status, sokeord }
}

/** Tom liste eller feil: forklar og pek til Prisfiler. */
export function PrislisteTom({ status, sokeord }: { status: SokStatus; sokeord: string }) {
  if (status === "feil") return <p className="py-6 text-center text-sm text-muted-foreground">Fikk ikke søkt i prislisten nå.</p>
  return (
    <p className="py-6 text-center text-sm text-muted-foreground">
      {sokeord.trim() ? `Ingen treff på «${sokeord.trim()}» i prislisten.` : "Ingen varer i prislisten ennå."}{" "}
      <Link href="/mine-priser/prisfiler" className="font-medium text-foreground underline underline-offset-2">
        Last opp prisfil
      </Link>
    </p>
  )
}

type PrislisteVelgerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  postNavn: string
  onVelg: (vare: SearchMaterial) => void
  /** Ingen vare passer: legg inn en tom materiell-linje i stedet. */
  onUtenPrisliste: () => void
}

/** «+ Materiell»: velg en vare fra prislisten, samme dialog som i tilbudsgeneratoren. */
export function PrislisteVelger({ open, onOpenChange, postNavn, onVelg, onUtenPrisliste }: PrislisteVelgerProps) {
  const [sok, setSok] = React.useState("")
  const { varer, status, sokeord } = usePrislisteSok(sok, open)
  const lukk = () => {
    onOpenChange(false)
    setSok("")
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : lukk())}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="space-y-1 border-b px-4 py-4 text-left">
          <DialogTitle>Legg til materiell fra prisliste</DialogTitle>
          <DialogDescription>Innprisen hentes fra prislisten, og påslaget legges på. Havner under «{postNavn}».</DialogDescription>
        </DialogHeader>

        <div className="border-b px-4 py-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              aria-label="Søk i prislisten"
              value={sok}
              onChange={(e) => setSok(e.target.value)}
              placeholder="Søk på produkt, NOBB, kategori …"
              className="pl-9"
            />
          </div>
        </div>

        <div className="max-h-[min(420px,50vh)] overflow-y-auto p-2">
          {status === "laster" ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Søker …
            </div>
          ) : varer.length === 0 ? (
            <PrislisteTom status={status} sokeord={sokeord} />
          ) : (
            <ul className="space-y-1">
              {varer.map((vare) => (
                <li key={vare.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onVelg(vare)
                      lukk()
                    }}
                    className="flex min-h-11 w-full items-start justify-between gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{vare.product}</span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {[vare.supplier, vare.unit, vare.category].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums">{formatKr(vare.unitPriceNok)}</span>
                      <span className="block text-[11px] text-muted-foreground">innpris</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t px-3 py-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              onUtenPrisliste()
              lukk()
            }}
          >
            <PlusIcon aria-hidden />
            Legg inn uten prisliste
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
