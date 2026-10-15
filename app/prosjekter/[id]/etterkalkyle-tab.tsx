"use client"

import * as React from "react"
import { ArrowRightIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { KalkyleOmrade } from "@/components/kalkyle/kalkyle-omrade"
import { useHarKalkyleKontekst, useKalkyle } from "@/components/kalkyle/kalkyle-provider"
import { KalkyleVelger } from "@/components/kalkyle/kalkyle-velger"
import { beregnEtterkalkyle } from "@/lib/kalkyle/beregn"
import { formatAntall, formatDato, formatKr, formatKrMedFortegn, formatProsent } from "@/lib/kalkyle/format"
import { MOCK_FAKTISK, MOCK_KALKYLE } from "@/lib/kalkyle/mock"
import type { EtterkalkyleFaktisk, EtterkalkylePost, EtterkalkyleResultat } from "@/lib/kalkyle/types"
import type { ProjectProfitability } from "@/lib/job-costing/types"
import { cn } from "@/lib/utils"

import { LonnsomhetTab } from "./lonnsomhet-tab"
import { useProjectTabNavigation } from "./project-tabs-shell"

const SEKSJONER = [
  { id: "etterkalkyle-sammendrag", navn: "Sammendrag" },
  { id: "etterkalkyle-poster", navn: "Per post" },
  { id: "etterkalkyle-kostnader", navn: "Kostnader og innkjøp" },
] as const

type EtterkalkyleTabProps = {
  projectId: string
  canManage: boolean
  /** Ekte lønnsomhet fra timer og regnskap (samme som Økonomi). */
  profitability: ProjectProfitability | null
}

/**
 * Prosjekt → Etterkalkyle. Det signerte tilbudet på valgt kalkyle mot det som
 * faktisk ble ført. Sammendrag og per post bygger på tilbudets frosne kopi av
 * kalkylen (mock til kalkylen lagres); «Kostnader og innkjøp» er dagens ekte
 * lønnsomhet, så ingenting fra Økonomi går tapt når den fanen fjernes.
 */
export function EtterkalkyleTab(props: EtterkalkyleTabProps) {
  // Samme kalkyler som Kalkyle-fanen (KalkyleOmrade i page.tsx); alene lager fanen sin egen.
  const delt = useHarKalkyleKontekst()
  const innhold = <EtterkalkyleInnhold {...props} />
  return delt ? innhold : <KalkyleOmrade>{innhold}</KalkyleOmrade>
}

/** Ført tid og innkjøp per post. Mock: bare eksempelbadet har føringer ennå. */
function faktiskFor(kalkyleId: string): EtterkalkyleFaktisk {
  return kalkyleId === MOCK_KALKYLE.id ? MOCK_FAKTISK : { poster: [] }
}

function EtterkalkyleInnhold({ projectId, canManage, profitability }: EtterkalkyleTabProps) {
  const { kalkyle, kalkyler, tilbud } = useKalkyle()
  const signertTilbud = tilbud.find((o) => o.status === "signert") ?? null
  const e = React.useMemo(
    () => (signertTilbud ? beregnEtterkalkyle(signertTilbud, faktiskFor(signertTilbud.kalkyle.id)) : null),
    [signertTilbud]
  )
  const seksjoner = e ? SEKSJONER : SEKSJONER.filter((s) => s.id !== "etterkalkyle-poster")

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[176px_minmax(0,1fr)]">
      <nav aria-label="Seksjoner i etterkalkylen" className="sticky top-4 hidden lg:block">
        <ul className="flex flex-col">
          {seksjoner.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={(ev) => {
                  ev.preventDefault()
                  document.getElementById(s.id)?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
                className="flex border-l-2 border-border px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
              >
                {s.navn}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0 space-y-8">
        <section id="etterkalkyle-sammendrag" aria-labelledby="etterkalkyle-tittel" className="scroll-mt-4 space-y-3">
          <div>
            <h2 id="etterkalkyle-tittel" className="text-base font-semibold">
              Etterkalkyle
            </h2>
            <p className="text-sm text-muted-foreground">
              Signert tilbud mot ført tid og innkjøp.
              {signertTilbud?.signertDato
                ? ` ${signertTilbud.navn} ble signert ${formatDato(signertTilbud.signertDato)}, og tallene er låst fra da.`
                : ""}
            </p>
          </div>
          {kalkyler.length > 0 && <KalkyleVelger />}
          {e ? (
            <>
              <Nokkeltall e={e} />
              <div className="grid items-start gap-3 lg:grid-cols-2">
                <DetSomSkjedde poster={e.poster} />
                <NesteGang poster={e.poster} />
              </div>
            </>
          ) : (
            <IngenSignert kalkyleNavn={kalkyle?.navn ?? null} />
          )}
        </section>

        {e && (
          <section id="etterkalkyle-poster" aria-labelledby="etterkalkyle-poster-tittel" className="scroll-mt-4 space-y-3">
            <PerPost poster={e.poster} />
          </section>
        )}

        <section id="etterkalkyle-kostnader" aria-labelledby="etterkalkyle-kostnader-tittel" className="scroll-mt-4 space-y-3">
          <div>
            <h2 id="etterkalkyle-kostnader-tittel" className="text-base font-semibold">
              Kostnader og innkjøp
            </h2>
            <p className="text-sm text-muted-foreground">
              Timer, materialkostnader og bilag fra regnskapet, mot budsjettet. Samme tall som før under Økonomi.
            </p>
          </div>
          <LonnsomhetTab projectId={projectId} canManage={canManage} initialData={profitability} />
        </section>
      </div>
    </div>
  )
}

function IngenSignert({ kalkyleNavn }: { kalkyleNavn: string | null }) {
  const navigate = useProjectTabNavigation()
  return (
    <div className="rounded-lg border border-dashed bg-muted/20 px-4 py-6 text-center">
      <p className="text-sm font-medium">
        {kalkyleNavn ? `Ingen signert tilbud på «${kalkyleNavn}» ennå` : "Ingen kalkyle på prosjektet ennå"}
      </p>
      <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
        Etterkalkylen kommer når kunden har signert et tilbud fra kalkylen. Da ser du timer og innkjøp mot det du regnet med,
        per post.
      </p>
      <Button type="button" variant="outline" className="mt-3" onClick={() => navigate("kalkyle", kalkyleNavn ? "tilbud" : null)}>
        {kalkyleNavn ? "Gå til tilbudet" : "Lag kalkyle"}
        <ArrowRightIcon aria-hidden />
      </Button>
    </div>
  )
}

function Tall({
  label,
  verdi,
  under,
  tone,
}: {
  label: string
  verdi: string
  under?: string
  tone?: "over" | "under"
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{verdi}</p>
      {under ? (
        <p
          className={cn(
            "mt-0.5 text-xs tabular-nums",
            tone === "over" ? "font-medium text-[#8a5f1b]" : tone === "under" ? "font-medium text-[#4d7219]" : "text-muted-foreground"
          )}
        >
          {under}
        </p>
      ) : null}
    </div>
  )
}

function Nokkeltall({ e }: { e: EtterkalkyleResultat }) {
  const t = e.totalt
  const timerAvvik = t.faktiskTimer - t.kalkulertTimer
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tall label="Fastpris eks. mva" verdi={formatKr(t.fastpris)} under="Signert tilbud" />
      <Tall
        label="Faktisk kostnad"
        verdi={formatKr(t.faktiskKost)}
        under={`${formatKrMedFortegn(t.avvik)} mot kalkyle (${formatKr(t.kalkulertKost)})`}
        tone={t.avvik > 0 ? "over" : t.avvik < 0 ? "under" : undefined}
      />
      <Tall
        label="Timer faktisk / kalkulert"
        verdi={`${formatAntall(t.faktiskTimer)} / ${formatAntall(t.kalkulertTimer)} t`}
        under={
          timerAvvik === 0
            ? "Som kalkulert"
            : `${timerAvvik > 0 ? "+" : "−"}${formatAntall(Math.abs(timerAvvik))} t${
                t.kalkulertTimer > 0 ? ` (${Math.round((Math.abs(timerAvvik) / t.kalkulertTimer) * 100)} % ${timerAvvik > 0 ? "over" : "under"})` : ""
              }`
        }
        tone={timerAvvik > 0 ? "over" : timerAvvik < 0 ? "under" : undefined}
      />
      <Tall
        label="Dekningsgrad"
        verdi={formatProsent(t.dekningsgradFaktisk)}
        under={`Kalkulert ${formatProsent(t.dekningsgradKalkulert)}`}
        tone={t.dekningsgradFaktisk < t.dekningsgradKalkulert ? "over" : undefined}
      />
    </div>
  )
}

function PerPost({ poster }: { poster: EtterkalkylePost[] }) {
  const maks = Math.max(1, ...poster.flatMap((p) => [p.kalkulertKost, p.faktiskKost]))
  const bredde = (n: number) => `${Math.max(0, Math.min(100, (n / maks) * 100))}%`
  return (
    <div className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <h2 id="etterkalkyle-poster-tittel" className="text-base font-semibold">
          Per post
        </h2>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-hidden>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-3.5 rounded-full bg-muted-foreground/40" />
            Kalkulert
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-3.5 rounded-full bg-foreground" />
            Faktisk
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-3.5 rounded-full bg-amber-600" />
            Faktisk, over kalkyle
          </span>
        </div>
      </div>
      <ul className="divide-y">
        {poster.map((p) => {
          const over = p.faktiskKost > p.kalkulertKost
          return (
            <li key={p.postId} className="px-4 py-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-semibold">{p.navn}</h3>
                <span
                  className={cn(
                    "text-sm font-semibold tabular-nums",
                    p.avvik > 0.5 ? "text-[#8a5f1b]" : p.avvik < -0.5 ? "text-[#4d7219]" : "text-muted-foreground"
                  )}
                >
                  {formatKrMedFortegn(p.avvik)}
                </span>
              </div>
              <dl className="grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-muted-foreground">Kalkulert</dt>
                <dd className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div className="h-full rounded-full bg-muted-foreground/40" style={{ width: bredde(p.kalkulertKost) }} />
                </dd>
                <dd className="text-right tabular-nums text-muted-foreground">
                  {formatKr(p.kalkulertKost)} · {formatAntall(p.kalkulertTimer)} t
                </dd>
                <dt className="text-muted-foreground">Faktisk</dt>
                <dd className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <div
                    className={cn("h-full rounded-full", over ? "bg-amber-600" : "bg-foreground")}
                    style={{ width: bredde(p.faktiskKost) }}
                  />
                </dd>
                <dd className="text-right font-medium tabular-nums">
                  {formatKr(p.faktiskKost)} · {formatAntall(p.faktiskTimer)} t
                </dd>
              </dl>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** «9 timer mer enn kalkulert, materiell +749 kr.» */
export function forklarAvvik(p: EtterkalkylePost): string {
  const deler: string[] = []
  const dt = p.faktiskTimer - p.kalkulertTimer
  if (dt !== 0) {
    const n = formatAntall(Math.abs(dt))
    deler.push(`${n} ${Math.abs(dt) === 1 ? "time" : "timer"} ${dt > 0 ? "mer" : "mindre"} enn kalkulert`)
  }
  const dm = p.faktiskMateriell - p.kalkulertMateriell
  if (Math.round(dm) !== 0) deler.push(`innkjøp ${formatKrMedFortegn(dm)}`)
  return deler.length ? `${deler.join(", ")}.` : "Som kalkulert."
}

function DetSomSkjedde({ poster }: { poster: EtterkalkylePost[] }) {
  const avvik = [...poster].filter((p) => Math.round(p.avvik) !== 0).sort((a, b) => Math.abs(b.avvik) - Math.abs(a.avvik))
  return (
    <section aria-labelledby="det-som-skjedde" className="rounded-lg border bg-card p-4">
      <h3 id="det-som-skjedde" className="mb-2 text-sm font-semibold">
        Det som skjedde
      </h3>
      {avvik.length === 0 ? (
        <p className="text-sm text-muted-foreground">Alt gikk som kalkulert.</p>
      ) : (
        <ol className="divide-y">
          {avvik.slice(0, 4).map((p) => (
            <li key={p.postId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-2">
              <span className="text-sm font-medium">{p.navn}</span>
              <span className={cn("text-sm font-semibold tabular-nums", p.avvik > 0 ? "text-[#8a5f1b]" : "text-[#4d7219]")}>
                {formatKrMedFortegn(p.avvik)}
              </span>
              <span className="col-span-2 text-xs text-muted-foreground">{forklarAvvik(p)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function NesteGang({ poster }: { poster: EtterkalkylePost[] }) {
  const storst = [...poster].sort((a, b) => b.faktiskTimer - b.kalkulertTimer - (a.faktiskTimer - a.kalkulertTimer))[0]
  const harAvvik = storst && storst.faktiskTimer !== storst.kalkulertTimer
  return (
    <section
      aria-labelledby="neste-gang"
      className="rounded-lg border border-[#d7e8bf] bg-[color:var(--surface-success)] p-4"
    >
      <h3 id="neste-gang" className="mb-1 text-sm font-semibold">
        Neste jobb blir riktigere
      </h3>
      <p className="mb-3 text-sm text-[#2f2f2f]">
        {harAvvik
          ? `«${storst.navn}» tok ${formatAntall(storst.faktiskTimer)} t, ikke ${formatAntall(storst.kalkulertTimer)} t. Oppdaterer du malen, regner neste kalkyle med de faktiske timene.`
          : "Timene stemte med kalkylen. Malen trenger ikke endres."}
      </p>
      <Button
        type="button"
        disabled={!harAvvik}
        onClick={() => toast.info("Oppdatering av maler kommer når malene lagres i databasen.")}
      >
        <RefreshCwIcon aria-hidden />
        Oppdater malen
      </Button>
    </section>
  )
}
