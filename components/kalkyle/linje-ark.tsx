"use client"

import * as React from "react"
import Link from "next/link"
import { SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { ArkFelt, ArkTall, ArkValg, LinjeArkSkall, arkInput } from "@/components/linjetabell/linje-ark-skall"
import { lesTall } from "@/components/linjetabell/linjetabell"
import { beregnLinje, paslagFor } from "@/lib/kalkyle/beregn"
import { formatAntall, formatKr } from "@/lib/kalkyle/format"
import { enhetFraPrisfil } from "@/lib/kalkyle/mine-priser"
import type { Enhet, LinjeType } from "@/lib/kalkyle/types"
import { cn } from "@/lib/utils"
import { TimeprisVelger } from "./kalkyle-poster"
import { useKalkyle } from "./kalkyle-provider"
import { ENHETER, LINJE_TYPE, enhetKort, patchForType } from "./linje-type"
import { useMinePriser } from "./mine-priser-kontekst"
import { PrislisteTom, usePrislisteSok } from "./prisliste-velger"

type LinjeArkProps = {
  valgt: { postId: string; linjeId: string } | null
  onLukk: () => void
}

const TYPE_VALG = (Object.keys(LINJE_TYPE) as LinjeType[]).map((t) => ({ verdi: t, navn: LINJE_TYPE[t].navn, prikk: LINJE_TYPE[t].prikk }))

/**
 * Redigering av én linje i det felles, kompakte arket: type, beskrivelse,
 * mengde og pris på få linjer, og «Kunden betaler / Din kostnad» nederst.
 */
export function LinjeArk({ valgt, onLukk }: LinjeArkProps) {
  const { kalkyle, oppdaterLinje, fjernLinje, medAngre, tilbakestill } = useKalkyle()
  // Kalkylen da arket ble åpnet, for «Avbryt». Arket monteres på nytt per linje (key i kalkyle-tab).
  const [vedApning] = React.useState(() => kalkyle)
  const post = valgt ? kalkyle?.poster.find((p) => p.id === valgt.postId) : undefined
  const linje = valgt ? post?.linjer.find((l) => l.id === valgt.linjeId) : undefined
  const [sok, setSok] = React.useState("")
  // Tekstfeltene holder det brukeren skriver («2,»), tallet lagres fortløpende.
  const [antallTekst, setAntallTekst] = React.useState("")
  const [prisTekst, setPrisTekst] = React.useState("")
  const [timerTekst, setTimerTekst] = React.useState("")
  const [paslagTekst, setPaslagTekst] = React.useState("")
  const { kilde } = useMinePriser()
  // Søket i prislisten kjører bare for materiell, og først når noe er skrevet.
  const prisliste = usePrislisteSok(sok, linje?.type === "materiell" && sok.trim().length >= 2)
  const linjeId = linje?.id
  const linjeType = linje?.type

  React.useEffect(() => {
    if (!linje || !kalkyle) return
    setAntallTekst(formatAntall(linje.antall))
    const pris = linje.type === "jobb" ? linje.fastpris : linje.innpris
    setPrisTekst(pris == null ? "" : formatAntall(pris))
    setTimerTekst(linje.timerPerEnhet == null ? "" : formatAntall(linje.timerPerEnhet))
    setPaslagTekst(formatAntall(paslagFor(linje, kalkyle)))
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
  const forslag = sok.trim().length >= 2 ? prisliste.varer.slice(0, 6) : []
  const enhet = enhetKort(linje.enhet)

  const slett = () => {
    const angre = medAngre(() => fjernLinje(post.id, linje.id))
    onLukk()
    toast(`«${linje.beskrivelse || "Linjen"}» er slettet`, { action: { label: "Angre", onClick: angre } })
  }

  return (
    <LinjeArkSkall
      open
      onLukk={onLukk}
      tittel={linje.beskrivelse ? type.navn : `Ny linje: ${type.navn.toLowerCase()}`}
      prikk={type.prikk}
      undertittel={post.navn}
      sum={{ kunden: formatKr(r.salgEksMva), kost: formatKr(r.kost) }}
      onSlett={slett}
      onAvbryt={() => {
        if (vedApning) tilbakestill(vedApning.id, vedApning)
        onLukk()
      }}
    >
      <ArkValg label="Type" valg={TYPE_VALG} value={linje.type} onChange={(t) => oppdater(patchForType(linje, t, r))} />

      {linje.type === "materiell" && (
        <div className="flex flex-col gap-1.5">
          <div className="relative">
            <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              id="linje-sok"
              type="search"
              aria-label="Finn i prislisten"
              value={sok}
              onChange={(e) => setSok(e.target.value)}
              placeholder="Finn i prislisten …"
              className={cn(arkInput, "pl-8")}
            />
          </div>
          {sok.trim().length >= 2 &&
            (prisliste.status === "laster" ? (
              <p className="px-1 text-xs text-muted-foreground">Søker …</p>
            ) : forslag.length === 0 ? (
              <PrislisteTom status={prisliste.status} sokeord={prisliste.sokeord} />
            ) : (
              <ul className="overflow-hidden rounded-md border">
                {forslag.map((f) => (
                  <li key={f.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        oppdater({ beskrivelse: f.product, enhet: enhetFraPrisfil(f.unit), innpris: f.unitPriceNok, anslag: false })
                        setPrisTekst(formatAntall(f.unitPriceNok))
                        setSok("")
                      }}
                      className="flex min-h-10 w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{f.product}</span>
                        <span className="block text-xs text-muted-foreground">{[f.supplier, f.unit].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="text-sm font-semibold whitespace-nowrap tabular-nums">{formatKr(f.unitPriceNok)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </div>
      )}

      <ArkFelt label="Beskrivelse" htmlFor="linje-beskrivelse">
        <input
          id="linje-beskrivelse"
          value={linje.beskrivelse}
          onChange={(e) => oppdater({ beskrivelse: e.target.value })}
          className={arkInput}
          autoFocus={!linje.beskrivelse && linje.type !== "materiell"}
        />
      </ArkFelt>

      <div className="grid grid-cols-2 gap-2.5">
        <ArkFelt label={linje.type === "arbeid" ? "Timer" : "Antall"} htmlFor="linje-antall">
          <ArkTall
            id="linje-antall"
            value={antallTekst}
            onChange={(t) => {
              setAntallTekst(t)
              oppdater({ antall: lesTall(t) })
            }}
          />
        </ArkFelt>
        <ArkFelt label="Enhet" htmlFor="linje-enhet">
          <select
            id="linje-enhet"
            value={linje.enhet}
            onChange={(e) => oppdater({ enhet: e.target.value as Enhet })}
            className={arkInput}
          >
            {ENHETER.map((e) => (
              <option key={e.verdi} value={e.verdi}>
                {e.navn}
              </option>
            ))}
          </select>
        </ArkFelt>
      </div>

      {linje.type === "arbeid" && (
        <ArkFelt
          label="Timepris"
          htmlFor="linje-timepris"
          hjelp={
            kilde.timepriser === "eksempel" ? (
              <>
                Eksempler. Legg inn egne under{" "}
                <Link href="/mine-priser/timepriser" className="font-medium text-foreground underline underline-offset-2">
                  Mine priser → Timepriser
                </Link>
                .
              </>
            ) : undefined
          }
        >
          <TimeprisVelger
            linje={linje}
            standardTimesats={kalkyle.timesats}
            label="Timepris"
            onVelg={(timepris) => oppdater({ timepris })}
            className={arkInput}
          />
        </ArkFelt>
      )}

      {linje.type === "jobb" && (
        <div className="grid grid-cols-2 gap-2.5">
          <ArkFelt label={`Fastpris per ${enhet}`} htmlFor="linje-fastpris">
            <ArkTall
              id="linje-fastpris"
              value={prisTekst}
              suffix="kr"
              onChange={(t) => {
                setPrisTekst(t)
                oppdater({ fastpris: lesTall(t) })
              }}
            />
          </ArkFelt>
          <ArkFelt label={`Timer per ${enhet}`} htmlFor="linje-timer">
            <ArkTall
              id="linje-timer"
              value={timerTekst}
              onChange={(t) => {
                setTimerTekst(t)
                oppdater({ timerPerEnhet: lesTall(t) || null })
              }}
            />
          </ArkFelt>
          <p className="col-span-2 text-xs text-muted-foreground">Kunden betaler fastprisen. Kostnaden er timer × intern kost.</p>
        </div>
      )}

      {(linje.type === "materiell" || linje.type === "ue") && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            <ArkFelt label={linje.type === "ue" ? "Pris fra underentreprenør" : `Innpris per ${enhet}`} htmlFor="linje-innpris">
              <ArkTall
                id="linje-innpris"
                value={prisTekst}
                suffix="kr"
                onChange={(t) => {
                  setPrisTekst(t)
                  oppdater({ innpris: lesTall(t), anslag: false })
                }}
              />
            </ArkFelt>
            <ArkFelt label="Påslag" htmlFor="linje-paslag">
              <ArkTall
                id="linje-paslag"
                value={paslagTekst}
                suffix="%"
                onChange={(t) => {
                  setPaslagTekst(t)
                  const v = lesTall(t)
                  // Tilbake til kalkylens påslag lagres som «ikke satt», så linja følger det igjen.
                  oppdater({ paslag: v === standardPaslag ? null : v })
                }}
              />
            </ArkFelt>
          </div>
          {paslag !== standardPaslag && (
            <button
              type="button"
              onClick={() => {
                oppdater({ paslag: null })
                setPaslagTekst(formatAntall(standardPaslag))
              }}
              className="-mt-1 self-start text-xs font-medium underline underline-offset-4"
            >
              Bruk kalkylens påslag ({formatAntall(standardPaslag)} %)
            </button>
          )}
          {linje.anslag && (
            <p className="rounded-md border border-[#f0dcb4] bg-[color:var(--surface-warning)] px-2.5 py-1.5 text-xs text-[#8a5f1b]">
              Prisen er anslått av SmartKI. Sjekk den mot leverandøren. Merket forsvinner når du endrer prisen.
            </p>
          )}
        </>
      )}
    </LinjeArkSkall>
  )
}
