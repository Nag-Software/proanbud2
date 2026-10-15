"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowRightIcon, ChevronDownIcon, InfoIcon, PencilIcon, PlusIcon } from "lucide-react"
import { toast } from "sonner"

import { ProjectPicker, type PickerProject } from "@/app/nytt-tilbud/project-picker"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { beregnKalkyle, instansierMal, klemParameter } from "@/lib/kalkyle/beregn"
import { formatAntall, formatKr } from "@/lib/kalkyle/format"
import { standardPrising } from "@/lib/kalkyle/mine-priser"
import { MOCK_MALER, MOCK_PRISING } from "@/lib/kalkyle/mock"
import type { KalkyleMal, MalLinje, Prising } from "@/lib/kalkyle/types"
import { cn } from "@/lib/utils"
import { LINJE_TYPE, enhetKort } from "./linje-type"
import { MinePriserProvider, useMinePriser } from "./mine-priser-kontekst"
import { TallStepper } from "./tall-stepper"

const IDER = { kalkyleId: "forhandsvisning", prosjektId: "forhandsvisning" }

function regn(mal: KalkyleMal, verdi: number, prising: Prising) {
  const kalkyle = instansierMal(mal, verdi, prising, IDER)
  return { kalkyle, resultat: beregnKalkyle(kalkyle) }
}

/** «4 + 3 per m²», «1 per stk», «6» – hvordan mengden følger størrelsen. */
export function mengdeRegel(linje: MalLinje, mal: KalkyleMal): string {
  const { fast, perEnhet } = linje.mengde
  const enhet = enhetKort(mal.parameter.enhet)
  if (!perEnhet) return formatAntall(fast)
  const per = `${formatAntall(perEnhet)} per ${enhet}`
  return fast ? `${formatAntall(fast)} + ${per}` : per
}

/** Lenken «Bruk i prosjektet» gir: Kalkyle-fanen åpner startskjermen med malen og størrelsen valgt. */
export function brukMalHref(prosjektId: string, malId: string, verdi: number) {
  const params = new URLSearchParams({ tab: "kalkyle", mal: malId, storrelse: String(verdi) })
  return `/prosjekter/${prosjektId}?${params.toString()}`
}

/** Mine priser → Kalkylemaler. Malene er mock-data til de får egne tabeller. */
export function KalkylemalerSide({ prosjekter }: { prosjekter: PickerProject[] }) {
  return (
    <MinePriserProvider>
      <KalkylemalerInnhold prosjekter={prosjekter} />
    </MinePriserProvider>
  )
}

function KalkylemalerInnhold({ prosjekter }: { prosjekter: PickerProject[] }) {
  const { timepriser, kilde } = useMinePriser()
  const prising = standardPrising(timepriser, MOCK_PRISING)
  const standard = timepriser[0]
  const [valgtId, setValgtId] = React.useState(MOCK_MALER[0].id)
  const [verdier, setVerdier] = React.useState<Record<string, number>>(() =>
    Object.fromEntries(MOCK_MALER.map((m) => [m.id, m.parameter.standard]))
  )
  const [apnePoster, setApnePoster] = React.useState<ReadonlySet<string>>(() => new Set())
  const [velgProsjekt, setVelgProsjekt] = React.useState(false)

  const mal = MOCK_MALER.find((m) => m.id === valgtId) ?? MOCK_MALER[0]
  const verdi = klemParameter(mal, verdier[mal.id])
  const { kalkyle, resultat } = regn(mal, verdi, prising)
  const p = mal.parameter
  const kommer = (hva: string) => toast.info(`${hva} kommer når malene lagres i databasen.`)

  const byttPost = (postId: string) =>
    setApnePoster((prev) => {
      const neste = new Set(prev)
      if (neste.has(postId)) neste.delete(postId)
      else neste.add(postId)
      return neste
    })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Kalkylemaler"
        subtitle="Ferdige oppsett for jobbene du gjør ofte. Velg størrelse, så regner malen ut timer og pris."
        actions={
          <Button type="button" variant="outline" onClick={() => kommer("Nye maler")}>
            <PlusIcon aria-hidden />
            Ny mal
          </Button>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <nav aria-label="Maler" className="flex flex-col gap-2">
          {MOCK_MALER.map((m) => {
            const fra = regn(m, m.parameter.min, prising).resultat.totalt.salgEksMva
            const aktiv = m.id === mal.id
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={aktiv}
                onClick={() => {
                  setValgtId(m.id)
                  setApnePoster(new Set())
                }}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-lg border bg-background px-3.5 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  aktiv ? "border-foreground" : "border-border"
                )}
              >
                <span className="flex w-full items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{m.navn}</span>
                  <span className="text-[13px] font-medium tabular-nums">fra {formatKr(fra)}</span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Standard {formatAntall(m.parameter.standard)} {enhetKort(m.parameter.enhet)} · {m.poster.length} poster
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">Brukt {m.antallGangerBrukt} ganger</span>
              </button>
            )
          })}
        </nav>

        <section aria-label={mal.navn} className="min-w-0 rounded-lg border bg-card shadow-[var(--shadow-surface)]">
          <div className="flex flex-wrap items-start justify-between gap-4 p-4">
            <div className="min-w-0 flex-1 basis-60">
              <h2 className="text-lg font-semibold tracking-tight">{mal.navn}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{mal.beskrivelse}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">{p.navn}</span>
              <TallStepper
                label={p.navn}
                verdi={verdi}
                steg={p.steg}
                min={p.min}
                max={p.max}
                visning={`${formatAntall(verdi)} ${enhetKort(p.enhet)}`}
                onChange={(v) => setVerdier((prev) => ({ ...prev, [mal.id]: v }))}
              />
            </div>
          </div>

          <div className="overflow-x-auto border-y">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Post</TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Timer
                  </TableHead>
                  <TableHead className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Eks. mva
                  </TableHead>
                </TableRow>
              </TableHeader>
              {kalkyle.poster.map((post, i) => {
                const r = resultat.poster[i]
                const malPost = mal.poster.find((mp) => mp.id === post.id)
                const apen = apnePoster.has(post.id)
                return (
                  <TableBody key={post.id}>
                    <TableRow>
                      <TableCell className="py-2">
                        <button
                          type="button"
                          onClick={() => byttPost(post.id)}
                          aria-expanded={apen}
                          className="flex items-center gap-2 rounded text-left text-sm font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        >
                          <ChevronDownIcon
                            aria-hidden
                            className={cn("size-3.5 text-muted-foreground transition-transform", !apen && "-rotate-90")}
                          />
                          {post.navn}
                          <Badge variant="outline" className="h-4 rounded-sm px-1.5 text-[10px] font-normal">
                            {post.linjer.length}
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell className="py-2 text-right text-sm tabular-nums text-muted-foreground">
                        {r.timer > 0 ? `${formatAntall(r.timer)} t` : "—"}
                      </TableCell>
                      <TableCell className="py-2 text-right text-sm font-semibold tabular-nums">{formatKr(r.salgEksMva)}</TableCell>
                    </TableRow>
                    {apen &&
                      post.linjer.map((linje, j) => {
                        const malLinje = malPost?.linjer[j]
                        return (
                          <TableRow key={linje.id} className="bg-muted/20 hover:bg-muted/30">
                            <TableCell className="py-1.5 pl-9 text-[13px]">
                              <span className="flex items-center gap-2">
                                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", LINJE_TYPE[linje.type].prikk)} />
                                <span>{linje.beskrivelse}</span>
                                <span className="text-muted-foreground tabular-nums">
                                  {formatAntall(linje.antall)} {enhetKort(linje.enhet)}
                                  {malLinje?.mengde.perEnhet ? ` (${mengdeRegel(malLinje, mal)})` : ""}
                                </span>
                              </span>
                            </TableCell>
                            <TableCell className="py-1.5 text-right text-[13px] tabular-nums text-muted-foreground">
                              {r.linjer[j].timer > 0 ? `${formatAntall(r.linjer[j].timer)} t` : ""}
                            </TableCell>
                            <TableCell className="py-1.5 text-right text-[13px] tabular-nums">
                              {formatKr(r.linjer[j].salgEksMva)}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                  </TableBody>
                )
              })}
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell className="text-sm font-semibold">Totalt eks. mva</TableCell>
                  <TableCell className="text-right text-sm font-semibold tabular-nums">
                    {formatAntall(resultat.totalt.timer)} t
                  </TableCell>
                  <TableCell className="text-right text-base font-bold tabular-nums">
                    {formatKr(resultat.totalt.salgEksMva)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          <div className="space-y-3 p-4">
            <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
              <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Timene i malen kan oppdateres fra etterkalkylen når et prosjekt er ferdig, så malen treffer bedre for
                hver jobb. Prisene bruker {standard ? `timeprisen «${standard.navn}» (${formatKr(prising.timesats)}/t)` : `${formatKr(prising.timesats)}/t`} og påslag på{" "}
                {prising.paslagMateriell} % på materiell og {prising.paslagUe} % på underentreprenør.
                {kilde.timepriser === "eksempel" && (
                  <>
                    {" "}
                    Timeprisene er eksempler –{" "}
                    <Link href="/mine-priser/timepriser" className="font-medium text-foreground underline underline-offset-2">
                      legg inn bedriftens egne
                    </Link>
                    .
                  </>
                )}
              </span>
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => kommer("Redigering av maler")}>
                <PencilIcon aria-hidden />
                Rediger mal
              </Button>
              <Button type="button" onClick={() => setVelgProsjekt(true)}>
                Bruk i prosjektet
                <ArrowRightIcon aria-hidden />
              </Button>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={velgProsjekt} onOpenChange={setVelgProsjekt}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader className="text-left">
            <DialogTitle>Hvilket prosjekt?</DialogTitle>
            <DialogDescription>
              «{mal.navn}», {formatAntall(verdi)} {enhetKort(p.enhet)}, åpnes i prosjektets kalkyle. Du ser den før noe
              legges inn.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[min(460px,60vh)] overflow-y-auto">
            <ProjectPicker projects={prosjekter} hrefFor={(prosjekt) => brukMalHref(prosjekt.id, mal.id, verdi)} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
