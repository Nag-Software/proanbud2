"use client"

import * as React from "react"
import Link from "next/link"
import { MinusIcon, PlusIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { beregnLinje, paslagFor } from "@/lib/kalkyle/beregn"
import { formatAntall, formatKr } from "@/lib/kalkyle/format"
import { enhetFraPrisfil } from "@/lib/kalkyle/mine-priser"
import type { Enhet, LinjeType } from "@/lib/kalkyle/types"
import { cn } from "@/lib/utils"
import { useKalkyle } from "./kalkyle-provider"
import { ENHETER, LINJE_TYPE, enhetKort, patchForType } from "./linje-type"
import { useMinePriser } from "./mine-priser-kontekst"
import { PrislisteTom, usePrislisteSok } from "./prisliste-velger"
import { TallStepper } from "./tall-stepper"

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
  const [timerTekst, setTimerTekst] = React.useState("")
  const { timepriser, kilde } = useMinePriser()
  // Søket i prislisten kjører bare for materiell, og først når noe er skrevet.
  const prisliste = usePrislisteSok(sok, linje?.type === "materiell" && sok.trim().length >= 2)
  const linjeId = linje?.id
  const linjeType = linje?.type

  React.useEffect(() => {
    if (!linje) return
    setAntallTekst(formatAntall(linje.antall))
    const pris = linje.type === "jobb" ? linje.fastpris : linje.innpris
    setPrisTekst(pris == null ? "" : formatAntall(pris))
    setTimerTekst(linje.timerPerEnhet == null ? "" : formatAntall(linje.timerPerEnhet))
    setSok("")
    // Bare når en linje åpnes eller bytter type, ikke ved hvert tastetrykk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linjeId, linjeType])

  if (!kalkyle || !post || !linje) return null

  const type = LINJE_TYPE[linje.type]
  const r = beregnLinje(linje, kalkyle)
  const standardPaslag = linje.type === "materiell" ? kalkyle.paslagMateriell : kalkyle.paslagUe
  const paslag = paslagFor(linje, kalkyle)
  const oppdater = (patch: Parameters<typeof oppdaterLinje>[2]) => oppdaterLinje(post.id, linje.id, patch)
  const settAntall = (verdi: number) => {
    oppdater({ antall: verdi })
    setAntallTekst(formatAntall(verdi))
  }
  const forslag = sok.trim().length >= 2 ? prisliste.varer.slice(0, 6) : []

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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xs font-medium text-muted-foreground">Type</legend>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(LINJE_TYPE) as LinjeType[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  aria-pressed={linje.type === t}
                  onClick={() => linje.type !== t && oppdater(patchForType(linje, t, r))}
                  className={cn(
                    "flex min-h-10 items-center gap-2 rounded-[8px] border px-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11",
                    linje.type === t ? "border-foreground font-medium" : "border-border text-muted-foreground"
                  )}
                >
                  <span aria-hidden className={cn("size-2 rounded-full", LINJE_TYPE[t].prikk)} />
                  {LINJE_TYPE[t].navn}
                </button>
              ))}
            </div>
          </fieldset>

          {linje.type === "materiell" && (
            <div className="flex flex-col gap-2">
              <label htmlFor="linje-sok" className="text-xs font-medium text-muted-foreground">
                Finn i prislisten
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
              {sok.trim().length >= 2 &&
                (prisliste.status === "laster" ? (
                  <p className="px-1 text-sm text-muted-foreground">Søker …</p>
                ) : forslag.length === 0 ? (
                  <PrislisteTom status={prisliste.status} sokeord={prisliste.sokeord} />
                ) : (
                  <ul className="overflow-hidden rounded-lg border">
                    {forslag.map((f) => (
                      <li key={f.id} className="border-b last:border-b-0">
                        <button
                          type="button"
                          onClick={() => {
                            oppdater({ beskrivelse: f.product, enhet: enhetFraPrisfil(f.unit), innpris: f.unitPriceNok, anslag: false })
                            setPrisTekst(formatAntall(f.unitPriceNok))
                            setSok("")
                          }}
                          className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{f.product}</span>
                            <span className="block text-[13px] text-muted-foreground">
                              {[f.supplier, f.unit].filter(Boolean).join(" · ")}
                            </span>
                          </span>
                          <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatKr(f.unitPriceNok)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ))}
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

          {linje.type === "arbeid" && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-xs font-medium text-muted-foreground">Timepris</legend>
              <div className="flex flex-col gap-1.5">
                {[null, ...timepriser].map((tp) => {
                  const valgt = (linje.timepris?.id ?? null) === (tp?.id ?? null)
                  return (
                    <button
                      key={tp?.id ?? "standard"}
                      type="button"
                      aria-pressed={valgt}
                      onClick={() => oppdater({ timepris: tp })}
                      className={cn(
                        "flex min-h-11 items-center justify-between gap-3 rounded-[10px] border px-3.5 py-2 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring",
                        valgt ? "border-foreground" : "border-border"
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{tp ? tp.navn : "Standard"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {tp
                            ? tp.internKost != null
                              ? `Kost ${formatKr(tp.internKost)}/t`
                              : "Kostpris ikke satt, intern kost brukes"
                            : "Fra prisingen øverst"}
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {formatKr(tp ? tp.timesats : kalkyle.timesats)}/t
                      </span>
                    </button>
                  )
                })}
              </div>
              {kilde.timepriser === "eksempel" && (
                <p className="text-xs text-muted-foreground">
                  Eksempler. Legg inn bedriftens egne under{" "}
                  <Link href="/mine-priser/timepriser" className="font-medium text-foreground underline underline-offset-2">
                    Mine priser → Timepriser
                  </Link>
                  .
                </p>
              )}
            </fieldset>
          )}

          {linje.type === "jobb" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <label htmlFor="linje-fastpris" className="text-xs font-medium text-muted-foreground">
                  Fastpris per {enhetKort(linje.enhet)}
                </label>
                <div className="relative">
                  <Input
                    id="linje-fastpris"
                    inputMode="decimal"
                    value={prisTekst}
                    onChange={(e) => {
                      setPrisTekst(e.target.value)
                      oppdater({ fastpris: lesTall(e.target.value) })
                    }}
                    className="h-11 pr-11 text-base tabular-nums"
                  />
                  <span aria-hidden className="absolute top-1/2 right-3.5 -translate-y-1/2 text-muted-foreground">
                    kr
                  </span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="linje-timer" className="text-xs font-medium text-muted-foreground">
                  Timer per {enhetKort(linje.enhet)}
                </label>
                <Input
                  id="linje-timer"
                  inputMode="decimal"
                  value={timerTekst}
                  onChange={(e) => {
                    setTimerTekst(e.target.value)
                    oppdater({ timerPerEnhet: lesTall(e.target.value) || null })
                  }}
                  className="h-11 text-base tabular-nums"
                />
              </div>
              <p className="col-span-2 text-[13px] text-muted-foreground">
                Fast jobb fra Lagrede jobber. Kunden betaler fastprisen; kostnaden anslås som timer × intern kost.
              </p>
            </div>
          )}

          {(linje.type === "materiell" || linje.type === "ue") && (
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
                    oppdater({ innpris: lesTall(e.target.value), anslag: false })
                  }}
                  className="h-11 pr-11 text-base tabular-nums"
                />
                <span aria-hidden className="absolute top-1/2 right-3.5 -translate-y-1/2 text-muted-foreground">
                  kr
                </span>
              </div>
              {linje.anslag && (
                <p className="rounded-md border border-[#f0dcb4] bg-[color:var(--surface-warning)] px-2.5 py-1.5 text-[13px] text-[#8a5f1b]">
                  Prisen er anslått av SmartKI. Sjekk den mot leverandøren – merket forsvinner når du endrer prisen.
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] text-muted-foreground">
                  Påslag på denne linja{paslag !== standardPaslag ? "" : " (kalkylens)"}. Kunden ser bare sluttprisen.
                </span>
                <TallStepper
                  label="Påslag"
                  verdi={paslag}
                  steg={1}
                  max={1000}
                  visning={`${formatAntall(paslag)} %`}
                  onChange={(v) => oppdater({ paslag: v === standardPaslag ? null : v })}
                />
              </div>
              {paslag !== standardPaslag && (
                <button
                  type="button"
                  onClick={() => oppdater({ paslag: null })}
                  className="self-start text-[13px] font-medium underline underline-offset-4"
                >
                  Bruk kalkylens påslag ({formatAntall(standardPaslag)} %)
                </button>
              )}
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
