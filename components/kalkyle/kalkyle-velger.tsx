"use client"

import * as React from "react"
import { CheckIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { useConfirm } from "@/components/ui/confirm-dialog"
import { beregnKalkyle } from "@/lib/kalkyle/beregn"
import { formatKr } from "@/lib/kalkyle/format"
import { cn } from "@/lib/utils"
import { useKalkyle } from "./kalkyle-provider"

type KalkyleVelgerProps = {
  /** «+ Ny kalkyle» (Kalkyle-fanen). Etterkalkylen viser bare velgeren. */
  onNyKalkyle?: () => void
  className?: string
}

/**
 * Kalkylene på prosjektet («Bad 6 m²», «Kjøkken» …) som faner. Den valgte kan
 * få nytt navn eller slettes (med «Angre»). Viser kundens pris og om et tilbud
 * er signert.
 */
export function KalkyleVelger({ onNyKalkyle, className }: KalkyleVelgerProps) {
  const { kalkyler, kalkyle, velgKalkyle, endreKalkyleNavn, fjernKalkyle, tilstand } = useKalkyle()
  const confirm = useConfirm()
  const [redigerer, setRedigerer] = React.useState(false)
  const [utkast, setUtkast] = React.useState("")

  const signert = (id: string) => tilstand.tilbud.some((o) => o.kalkyle.id === id && o.status === "signert")
  const lagre = () => {
    const navn = utkast.trim()
    if (navn) endreKalkyleNavn(navn)
    setRedigerer(false)
  }
  const slett = async () => {
    if (!kalkyle) return
    const k = kalkyle
    // Et signert tilbud er grunnlaget for etterkalkylen: spør før det forsvinner.
    if (signert(k.id)) {
      const ok = await confirm({
        title: `Slette «${k.navn}»?`,
        description: "Kalkylen har et signert tilbud. Tilbudet og etterkalkylen for denne kalkylen slettes også.",
        confirmText: "Slett kalkylen",
        cancelText: "Avbryt",
        variant: "destructive",
      })
      if (!ok) return
    }
    const angre = fjernKalkyle(k.id)
    setRedigerer(false)
    toast(`«${k.navn}» er slettet`, { action: { label: "Angre", onClick: angre } })
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <div role="group" aria-label="Kalkyler på prosjektet" className="flex flex-wrap items-center gap-1.5">
        {kalkyler.map((k) => {
          const aktiv = k.id === kalkyle?.id
          if (aktiv && redigerer) {
            return (
              <div key={k.id} className="flex items-center gap-1 rounded-[8px] border border-foreground bg-background p-0.5 pl-2">
                <label htmlFor="kalkyle-navn" className="sr-only">
                  Navn på kalkylen
                </label>
                <input
                  id="kalkyle-navn"
                  autoFocus
                  value={utkast}
                  onChange={(e) => setUtkast(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") lagre()
                    if (e.key === "Escape") setRedigerer(false)
                  }}
                  className="h-8 w-44 bg-transparent text-sm font-semibold outline-none"
                />
                <Button type="button" variant="ghost" size="icon" className="size-8" aria-label="Lagre navnet" onClick={lagre}>
                  <CheckIcon className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-destructive"
                  aria-label={`Slett kalkylen ${k.navn}`}
                  onClick={() => void slett()}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </div>
            )
          }
          return (
            <div key={k.id} className="flex items-center">
              <button
                type="button"
                aria-pressed={aktiv}
                onClick={() => velgKalkyle(k.id)}
                className={cn(
                  "flex min-h-9 items-center gap-2 rounded-[8px] border px-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11",
                  aktiv ? "border-foreground bg-background font-semibold" : "border-border text-muted-foreground",
                  aktiv && "rounded-r-none border-r-0"
                )}
              >
                {k.navn || "Uten navn"}
                <span className="text-xs font-normal tabular-nums text-muted-foreground">
                  {formatKr(beregnKalkyle(k).totalt.inklMva)}
                </span>
                {signert(k.id) && (
                  <span className="rounded-sm border border-[#d7e8bf] bg-[color:var(--surface-success)] px-1.5 text-[10px] font-semibold text-[#4d7219]">
                    Signert
                  </span>
                )}
              </button>
              {aktiv && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9 rounded-l-none rounded-r-[8px] border border-l-0 border-foreground pointer-coarse:size-11"
                  aria-label={`Gi nytt navn til ${k.navn}`}
                  onClick={() => {
                    setUtkast(k.navn)
                    setRedigerer(true)
                  }}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {onNyKalkyle && (
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onNyKalkyle}>
          <PlusIcon aria-hidden />
          Ny kalkyle
        </Button>
      )}
    </div>
  )
}
