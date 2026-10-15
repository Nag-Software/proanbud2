"use client"

import * as React from "react"
import {
  AppWindowIcon,
  ArrowRightIcon,
  BathIcon,
  CookingPotIcon,
  FenceIcon,
  HouseIcon,
  PlusIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { beregnKalkyle, instansierMal, klemParameter } from "@/lib/kalkyle/beregn"
import { formatAntall, formatKr } from "@/lib/kalkyle/format"
import { MOCK_MALER, MOCK_PRISING } from "@/lib/kalkyle/mock"
import { standardPrising } from "@/lib/kalkyle/mine-priser"
import type { Kalkyle, KalkyleMal, Prising } from "@/lib/kalkyle/types"
import { cn } from "@/lib/utils"
import { TallStepper } from "./tall-stepper"
import { enhetKort } from "./linje-type"
import { useMinePriser } from "./mine-priser-kontekst"

const IKON: Record<string, LucideIcon> = {
  "bad-komplett": BathIcon,
  "etterisolering-loft": HouseIcon,
  terrasse: FenceIcon,
  vindusbytte: AppWindowIcon,
  kjokkenmontering: CookingPotIcon,
}

const SPORSMAL: Record<string, string> = {
  "bad-komplett": "Hvor stort er badet?",
  "etterisolering-loft": "Hvor stort er loftet?",
  terrasse: "Hvor stor blir terrassen?",
  vindusbytte: "Hvor mange vinduer?",
  kjokkenmontering: "Hvor mange meter benk?",
}

/** Malen som passer best til en fritekst, for «Beskriv jobben». */
function gjettMal(tekst: string): KalkyleMal {
  const t = tekst.toLowerCase()
  const treff: Array<[RegExp, string]> = [
    [/loft|isoler/, "etterisolering-loft"],
    [/terrasse|platting|veranda/, "terrasse"],
    [/vindu/, "vindusbytte"],
    [/kjøkken|benk/, "kjokkenmontering"],
  ]
  const id = treff.find(([re]) => re.test(t))?.[1] ?? "bad-komplett"
  return MOCK_MALER.find((m) => m.id === id) ?? MOCK_MALER[0]
}

function lagKalkyle(mal: KalkyleMal, verdi: number, prosjektId: string, prising: Prising): Kalkyle {
  return instansierMal(mal, verdi, prising, { kalkyleId: `kalkyle-${mal.id}`, prosjektId })
}

function lagBlank(prosjektId: string, prising: Prising): Kalkyle {
  return {
    ...prising,
    id: "kalkyle-blank",
    prosjektId,
    poster: [{ id: "post-1", navn: "Post 1", rekkefolge: 1, linjer: [] }],
  }
}

type KalkyleStartProps = {
  prosjektId: string
  onFerdig: (kalkyle: Kalkyle) => void
  /** Fritekst: lager et utgangspunkt fra nærmeste mal og åpner samtalen med teksten. */
  onBeskriv: (kalkyle: Kalkyle, tekst: string) => void
  onAvbryt?: () => void
}

/** «Hva skal du lage kalkyle for?» – velg jobb, svar på ett spørsmål om størrelse, ferdig. */
export function KalkyleStart({ prosjektId, onFerdig, onBeskriv, onAvbryt }: KalkyleStartProps) {
  const [valgt, setValgt] = React.useState<string>(MOCK_MALER[0].id)
  const [verdier, setVerdier] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(MOCK_MALER.map((m) => [m.id, m.parameter.standard]))
  )
  const [beskrivelse, setBeskrivelse] = React.useState("")
  // Ny kalkyle prises med bedriftens standard timepris (første i Timepriser).
  const { timepriser } = useMinePriser()
  const prising = standardPrising(timepriser, MOCK_PRISING)
  const mal = MOCK_MALER.find((m) => m.id === valgt)
  const verdi = mal ? klemParameter(mal, verdier[mal.id]) : 0
  const forhand = mal ? beregnKalkyle(lagKalkyle(mal, verdi, prosjektId, prising)).totalt : null

  const flis = (aktiv: boolean) =>
    cn(
      "flex min-h-28 flex-col items-start gap-2 rounded-[10px] border-[1.5px] bg-background p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
      aktiv ? "border-foreground" : "border-border"
    )

  return (
    <div className="mx-auto max-w-[900px] pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-extrabold tracking-tight">Hva skal du lage kalkyle for?</h2>
          <p className="mt-1 text-[15px] text-muted-foreground">Velg jobben som ligner mest. Alt kan endres etterpå.</p>
        </div>
        {onAvbryt && (
          <Button type="button" variant="ghost" className="h-11" onClick={onAvbryt}>
            Avbryt
          </Button>
        )}
      </div>

      <div role="group" aria-label="Jobber" className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5">
        {MOCK_MALER.map((m) => {
          const Ikon = IKON[m.id] ?? PlusIcon
          return (
            <button key={m.id} type="button" aria-pressed={valgt === m.id} onClick={() => setValgt(m.id)} className={flis(valgt === m.id)}>
              <Ikon aria-hidden className="size-7" strokeWidth={1.6} />
              <span className="text-[15px] font-bold">{m.navn}</span>
              <span className="text-[12.5px] text-muted-foreground">Brukt {m.antallGangerBrukt} ganger</span>
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={valgt === "blank"}
          onClick={() => setValgt("blank")}
          className={cn(flis(valgt === "blank"), "border-dashed")}
        >
          <PlusIcon aria-hidden className="size-7" strokeWidth={1.6} />
          <span className="text-[15px] font-bold">Start blankt</span>
          <span className="text-[12.5px] text-muted-foreground">Bygg kalkylen selv</span>
        </button>
      </div>

      <section aria-label="Beskriv jobben" className="mt-3.5 rounded-2xl border bg-background p-1.5 shadow-[0_8px_28px_rgba(21,21,21,0.08)] focus-within:border-foreground/30">
        <label htmlFor="kalkyle-beskriv" className="block px-3 pt-2.5 text-sm font-bold">
          Finner du ikke jobben? Beskriv den med egne ord
        </label>
        <textarea
          id="kalkyle-beskriv"
          rows={3}
          value={beskrivelse}
          onChange={(e) => setBeskrivelse(e.target.value)}
          placeholder="F.eks. «Bad på 8 m² i kjeller. Rive alt, ny membran, fliser på vegg og gulv og varmekabler.»"
          className="block w-full resize-none bg-transparent px-3 py-2 text-base leading-relaxed outline-none placeholder:text-muted-foreground"
        />
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-1">
          <span className="text-[13px] text-muted-foreground">
            Du får et utgangspunkt med poster, timer og priser, og bestemmer selv hva som blir med.
          </span>
          <Button
            type="button"
            className="h-11 rounded-full px-5"
            disabled={beskrivelse.trim().length < 3}
            onClick={() => {
              const m = gjettMal(beskrivelse)
              onBeskriv(lagKalkyle(m, m.parameter.standard, prosjektId, prising), beskrivelse.trim())
            }}
          >
            Lag forslag
            <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      </section>

      {mal && forhand && (
        <>
          <section
            aria-label="Størrelse"
            className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-card p-5 shadow-[var(--shadow-surface)]"
          >
            <div className="min-w-0">
              <h3 className="text-lg font-bold">{SPORSMAL[mal.id] ?? `${mal.parameter.navn}?`}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Vanligst er {formatAntall(mal.parameter.standard)} {enhetKort(mal.parameter.enhet)}.
              </p>
            </div>
            <TallStepper
              stor
              label={mal.parameter.navn}
              verdi={verdi}
              steg={mal.parameter.steg}
              min={mal.parameter.min}
              max={mal.parameter.max}
              visning={`${formatAntall(verdi)} ${enhetKort(mal.parameter.enhet)}`}
              onChange={(v) => setVerdier((prev) => ({ ...prev, [mal.id]: v }))}
            />
          </section>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-foreground p-5 text-background">
            <div>
              <p className="text-sm text-background/75">Kunden betaler omtrent</p>
              <p className="text-3xl font-extrabold tracking-tight tabular-nums">{formatKr(forhand.inklMva)}</p>
              <p className="text-sm text-background/75 tabular-nums">
                inkl. mva · {formatAntall(forhand.timer)} timer arbeid · {mal.poster.length} poster
              </p>
            </div>
            <Button
              type="button"
              size="xl"
              className="rounded-[10px] bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={() => onFerdig(lagKalkyle(mal, verdi, prosjektId, prising))}
            >
              Lag kalkylen
              <ArrowRightIcon aria-hidden />
            </Button>
          </div>
        </>
      )}

      {valgt === "blank" && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-5">
          <p className="text-[15px]">Du starter med én tom post og legger til timer og materiell selv.</p>
          <Button type="button" size="xl" onClick={() => onFerdig(lagBlank(prosjektId, prising))}>
            Start blankt
            <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}
