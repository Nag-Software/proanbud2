"use client"

import * as React from "react"
import { MinusIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { beregnLinje } from "@/lib/kalkyle/beregn"
import { formatAntall, formatKr } from "@/lib/kalkyle/format"
import { MOCK_PRISFIL } from "@/lib/kalkyle/mock"
import type { Enhet } from "@/lib/kalkyle/types"
import { cn } from "@/lib/utils"
import { useKalkyle } from "./kalkyle-provider"
import { ENHETER, LINJE_TYPE, enhetKort } from "./linje-type"

type LinjeArkProps = {
  valgt: { postId: string; linjeId: string } | null
  onLukk: () => void
}

/** Tall fra et tekstfelt med komma eller punktum. Tomt eller rart blir 0. */
function lesTall(tekst: string): number {
  const n = parseFloat(tekst.replace(/\s/g, "").replace(",", "."))
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Redigering av én linje i et eget ark (fra høyre på PC, nedenfra på mobil):
 * store felt, −/+ for antall og «Kunden betaler / Din kostnad» mens du skriver.
 */
export function LinjeArk({ valgt, onLukk }: LinjeArkProps) {
  const isMobile = useIsMobile()
  const { kalkyle, oppdaterLinje, fjernLinje, settKalkyle } = useKalkyle()
  const post = valgt ? kalkyle?.poster.find((p) => p.id === valgt.postId) : undefined
  const linje = valgt ? post?.linjer.find((l) => l.id === valgt.linjeId) : undefined
  const [sok, setSok] = React.useState("")
  // Tekstfeltene holder det brukeren skriver («2,»), tallet lagres fortløpende.
  const [antallTekst, setAntallTekst] = React.useState("")
  const [prisTekst, setPrisTekst] = React.useState("")
  const linjeId = linje?.id

  React.useEffect(() => {
    if (!linje) return
    setAntallTekst(formatAntall(linje.antall))
    setPrisTekst(linje.innpris == null ? "" : formatAntall(linje.innpris))
    setSok("")
    // Bare når en ny linje åpnes, ikke ved hver tastetrykk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linjeId])

  if (!kalkyle || !post || !linje) return null

  const type = LINJE_TYPE[linje.type]
  const r = beregnLinje(linje, kalkyle)
  const paslag = linje.type === "materiell" ? kalkyle.paslagMateriell : kalkyle.paslagUe
  const oppdater = (patch: Parameters<typeof oppdaterLinje>[2]) => oppdaterLinje(post.id, linje.id, patch)
  const settAntall = (verdi: number) => {
    oppdater({ antall: verdi })
    setAntallTekst(formatAntall(verdi))
  }
  const q = sok.trim().toLowerCase()
  const forslag = MOCK_PRISFIL.filter((f) => !q || f.beskrivelse.toLowerCase().includes(q)).slice(0, 4)

  const slett = () => {
    const forrige = kalkyle
    fjernLinje(post.id, linje.id)
    onLukk()
    toast(`«${linje.beskrivelse || "Linjen"}» er slettet`, {
      action: { label: "Angre", onClick: () => settKalkyle(forrige) },
    })
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onLukk()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn("gap-0 p-0", isMobile ? "max-h-[92dvh] rounded-t-2xl" : "w-full sm:max-w-[440px]")}
      >
        <SheetHeader className="border-b px-5 py-3.5">
          <SheetTitle className="flex items-center gap-2 text-base">
            <span aria-hidden className={cn("size-2.5 rounded-full", type.prikk)} />
            {linje.beskrivelse ? type.navn : `Ny linje: ${type.navn.toLowerCase()}`}
          </SheetTitle>
          <SheetDescription>{post.navn}</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {linje.type === "materiell" && (
            <div className="flex flex-col gap-2">
              <label htmlFor="linje-sok" className="text-xs font-medium text-muted-foreground">
                Finn i prisfilene
              </label>
              <div className="relative">
                <SearchIcon aria-hidden className="absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="linje-sok"
                  type="search"
                  value={sok}
                  onChange={(e) => setSok(e.target.value)}
                  placeholder="F.eks. fliser, membran, lim"
                  className="h-11 pl-10 text-base"
                />
              </div>
              <ul className="overflow-hidden rounded-lg border">
                {forslag.map((f) => (
                  <li key={f.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        oppdater({ beskrivelse: f.beskrivelse, enhet: f.enhet, innpris: f.innpris })
                        setPrisTekst(formatAntall(f.innpris))
                        setSok("")
                      }}
                      className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{f.beskrivelse}</span>
                        <span className="block text-[13px] text-muted-foreground">Prisfil · {f.kilde}</span>
                      </span>
                      <span className="whitespace-nowrap text-sm font-semibold tabular-nums">
                        {formatKr(f.innpris)} / {enhetKort(f.enhet)}
                      </span>
                    </button>
                  </li>
                ))}
                {forslag.length === 0 && <li className="px-3.5 py-3 text-sm text-muted-foreground">Ingen treff i prisfilene.</li>}
              </ul>
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label htmlFor="linje-beskrivelse" className="text-xs font-medium text-muted-foreground">
              Hva er det?
            </label>
            <Input
              id="linje-beskrivelse"
              value={linje.beskrivelse}
              onChange={(e) => oppdater({ beskrivelse: e.target.value })}
              className="h-11 text-base"
              autoFocus={!linje.beskrivelse && linje.type !== "materiell"}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="linje-antall" className="text-xs font-medium text-muted-foreground">
              {linje.type === "arbeid" ? "Hvor mange timer?" : "Hvor mye?"}
            </label>
            <div className="flex items-stretch gap-2">
              <div className="flex items-center rounded-[10px] border bg-background">
                <Button
                  type="button"
                  variant="ghost"
                  className="size-11 rounded-r-none"
                  aria-label="Mindre"
                  onClick={() => settAntall(Math.max(0, linje.antall - 1))}
                >
                  <MinusIcon className="size-4" />
                </Button>
                <input
                  id="linje-antall"
                  inputMode="decimal"
                  value={antallTekst}
                  onChange={(e) => {
                    setAntallTekst(e.target.value)
                    oppdater({ antall: lesTall(e.target.value) })
                  }}
                  className="h-11 w-16 bg-transparent text-center text-base font-semibold tabular-nums outline-none"
                />
                <Button
                  type="button"
                  variant="ghost"
                  className="size-11 rounded-l-none"
                  aria-label="Mer"
                  onClick={() => settAntall(linje.antall + 1)}
                >
                  <PlusIcon className="size-4" />
                </Button>
              </div>
              <select
                aria-label="Enhet"
                value={linje.enhet}
                onChange={(e) => oppdater({ enhet: e.target.value as Enhet })}
                className="h-11 min-w-0 flex-1 rounded-[10px] border bg-background px-3 text-base"
              >
                {ENHETER.map((e) => (
                  <option key={e.verdi} value={e.verdi}>
                    {e.navn}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {linje.type === "arbeid" ? (
            <p className="rounded-lg bg-[color:var(--surface-info)] px-3.5 py-3 text-sm text-[#2f3f66] tabular-nums">
              Timepris {formatKr(kalkyle.timesats)}/t fra prisingen øverst.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <label htmlFor="linje-innpris" className="text-xs font-medium text-muted-foreground">
                {linje.type === "ue"
                  ? "Hva tar underentreprenøren?"
                  : `Hva betaler du per ${enhetKort(linje.enhet)}?`}
              </label>
              <div className="relative">
                <Input
                  id="linje-innpris"
                  inputMode="decimal"
                  value={prisTekst}
                  onChange={(e) => {
                    setPrisTekst(e.target.value)
                    oppdater({ innpris: lesTall(e.target.value) })
                  }}
                  className="h-11 pr-11 text-base tabular-nums"
                />
                <span aria-hidden className="absolute top-1/2 right-3.5 -translate-y-1/2 text-muted-foreground">
                  kr
                </span>
              </div>
              <p className="text-[13px] text-muted-foreground">
                Du legger på {paslag} %. Kunden ser bare sluttprisen.
              </p>
            </div>
          )}

          <div className="rounded-lg border bg-muted/40 px-3.5 py-3">
            <div className="flex justify-between gap-3 text-sm">
              <span>Kunden betaler</span>
              <strong className="tabular-nums">{formatKr(r.salgEksMva)}</strong>
            </div>
            <div className="mt-1 flex justify-between gap-3 text-[13px] text-muted-foreground">
              <span>Din kostnad</span>
              <span className="tabular-nums">{formatKr(r.kost)}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Eks. mva</p>
          </div>
        </div>

        <SheetFooter className="flex-row gap-2 border-t px-5 py-3">
          <Button type="button" variant="ghost" className="h-11 text-destructive" onClick={slett}>
            Slett linje
          </Button>
          <Button type="button" className="h-11 flex-1" onClick={onLukk}>
            Ferdig
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
