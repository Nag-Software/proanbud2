"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowRightIcon, Loader2Icon, SparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { track } from "@/lib/analytics/track"
import { reportClientError } from "@/lib/errors/client"

const FAG = [
  { key: "tomrer", label: "Tømrer" },
  { key: "elektriker", label: "Elektriker" },
  { key: "rorlegger", label: "Rørlegger" },
  { key: "maler", label: "Maler" },
  { key: "murer", label: "Murer" },
  { key: "annet", label: "Annet" },
] as const

type FagKey = (typeof FAG)[number]["key"]

type Tilbud = {
  tittel: string
  innledning: string
  linjer: Array<{ beskrivelse: string; mengde: number; enhet: string; enhetsprisNok: number; sumNok: number }>
  forbehold: string[]
  subtotalNok: number
  mvaNok: number
  totalNok: number
}

const nok = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 0 })
const mengdeFmt = new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 })

const SIGNUP_URL = "/signup?utm_source=kalkulator&utm_medium=produkt&utm_campaign=gratis-kalkulator"

const PLACEHOLDER =
  "F.eks: Bytte 12 vinduer i enebolig fra 1978. To etasjer, trenger stillas på baksiden. " +
  "Kunden ønsker trevinduer med aluminiumskledning. Riving og bortkjøring av de gamle vinduene er inkludert."

export function KalkulatorClient() {
  const [fag, setFag] = useState<FagKey>("tomrer")
  const [beskrivelse, setBeskrivelse] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [limitHit, setLimitHit] = useState(false)
  const [tilbud, setTilbud] = useState<Tilbud | null>(null)

  async function generer() {
    if (beskrivelse.trim().length < 20 || loading) return
    setLoading(true)
    setError(null)
    setLimitHit(false)
    try {
      const res = await fetch("/api/kalkulator", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ beskrivelse: beskrivelse.trim(), fag }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        track("kalkulator_grense_nadd")
        setLimitHit(true)
        setError(data.error || "Dagens gratis tilbud er brukt opp.")
        return
      }
      if (!res.ok || !data.tilbud) {
        throw new Error(data.error || "Kunne ikke lage tilbudet.")
      }
      track("kalkulator_generert", { fag })
      setTilbud(data.tilbud as Tilbud)
    } catch (err) {
      track("kalkulator_feilet")
      reportClientError(err, { level: "warning", context: { action: "generer gratis kalkulator-tilbud" } })
      setError(err instanceof Error ? err.message : "Noe gikk galt. Prøv igjen.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-svh bg-muted/40">
      {/* Toppstripe */}
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-4">
          <a href="https://proanbud.no" aria-label="Proanbud">
            <Image src="/logo/light/logo-primary.svg" alt="Proanbud" width={110} height={36} priority />
          </a>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Logg inn</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href={SIGNUP_URL} onClick={() => track("kalkulator_cta_klikket", { plassering: "topp" })}>
                Prøv Proanbud gratis
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-10">
        {/* Hero */}
        <div className="space-y-3 text-center">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Gratis · ingen innlogging
          </p>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Tilbudskalkulator for håndverkere
          </h1>
          <p className="mx-auto max-w-xl text-base leading-relaxed text-muted-foreground">
            Lim inn notatene fra befaringen, så bygger Proanbud et komplett pristilbud på
            sekunder — med poster, mengder og priser du kan justere.
          </p>
        </div>

        {/* Skjema */}
        <div className="mt-8 rounded-2xl border bg-background p-5 shadow-sm sm:p-6">
          <p className="text-sm font-medium">Hva slags fag?</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {FAG.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFag(f.key)}
                className={cn(
                  "rounded-full border px-4 py-2 text-sm transition-colors",
                  fag === f.key
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-background text-foreground hover:bg-muted"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <p className="mt-5 text-sm font-medium">Beskriv jobben</p>
          <Textarea
            value={beskrivelse}
            onChange={(e) => setBeskrivelse(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={6}
            maxLength={2000}
            className="mt-2 resize-y text-base"
          />
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>Jo mer detaljer, jo bedre tilbud.</span>
            <span>{beskrivelse.length}/2000</span>
          </div>

          {error && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
              {limitHit && (
                <div className="mt-2">
                  <Button size="sm" asChild>
                    <Link href={SIGNUP_URL} onClick={() => track("kalkulator_cta_klikket", { plassering: "grense" })}>
                      Registrer deg gratis — uten kort
                    </Link>
                  </Button>
                </div>
              )}
            </div>
          )}

          <Button
            className="mt-5 h-12 w-full text-base"
            onClick={generer}
            disabled={loading || beskrivelse.trim().length < 20}
          >
            {loading ? (
              <>
                <Loader2Icon className="mr-2 size-5 animate-spin" />
                Bygger tilbudet …
              </>
            ) : (
              <>
                <SparklesIcon className="mr-2 size-5" />
                Lag tilbudet
              </>
            )}
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            3 gratis tilbud per dag. Ingen konto nødvendig.
          </p>
        </div>

        {/* Resultat */}
        {tilbud && (
          <div className="mt-10">
            {/* Tilbudsdokumentet */}
            <div className="relative overflow-hidden rounded-2xl border bg-background shadow-sm">
              {/* Vannmerke */}
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <p className="-rotate-[24deg] select-none whitespace-nowrap text-4xl font-bold uppercase tracking-[0.35em] text-foreground/[0.06] sm:text-5xl">
                  Utkast · Proanbud
                </p>
              </div>

              <div className="p-6 sm:p-8">
                <p className="text-xs uppercase tracking-widest text-muted-foreground">Pristilbud</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{tilbud.tittel}</h2>
                {tilbud.innledning && (
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                    {tilbud.innledning}
                  </p>
                )}

                <div className="mt-6 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">Beskrivelse</th>
                        <th className="py-2 pr-3 text-right font-medium">Mengde</th>
                        <th className="py-2 pr-3 font-medium">Enhet</th>
                        <th className="py-2 pr-3 text-right font-medium">À-pris</th>
                        <th className="py-2 text-right font-medium">Sum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tilbud.linjer.map((linje, i) => (
                        <tr key={i} className="border-b border-border/60">
                          <td className="py-2.5 pr-3">{linje.beskrivelse}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{mengdeFmt.format(linje.mengde)}</td>
                          <td className="py-2.5 pr-3">{linje.enhet}</td>
                          <td className="py-2.5 pr-3 text-right tabular-nums">{nok.format(linje.enhetsprisNok)}</td>
                          <td className="py-2.5 text-right font-medium tabular-nums">{nok.format(linje.sumNok)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="ml-auto mt-4 w-full max-w-xs space-y-1.5 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Sum eks. mva</span>
                    <span className="tabular-nums">{nok.format(tilbud.subtotalNok)} kr</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Mva 25 %</span>
                    <span className="tabular-nums">{nok.format(tilbud.mvaNok)} kr</span>
                  </div>
                  <div className="flex justify-between border-t pt-1.5 text-base font-semibold">
                    <span>Å betale</span>
                    <span className="tabular-nums">{nok.format(tilbud.totalNok)} kr</span>
                  </div>
                </div>

                {tilbud.forbehold.length > 0 && (
                  <div className="mt-6">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Forbehold
                    </p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                      {tilbud.forbehold.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-6 text-xs text-muted-foreground">
                  Prisene er automatiske estimater basert på beskrivelsen — juster mot dine egne
                  priser før du sender tilbudet.
                </p>
              </div>

              <div className="border-t bg-muted/50 px-6 py-3 text-center text-xs text-muted-foreground">
                Laget med Proanbud · proanbud.no
              </div>
            </div>

            {/* CTA */}
            <div className="mt-6 rounded-2xl border border-primary/25 bg-primary/5 p-6 text-center sm:p-8">
              <h3 className="text-lg font-semibold tracking-tight">Klar til å sende det til kunden?</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Med gratis prøveperiode får du tilbudet med din logo og dine priser, sender det
                digitalt, og kunden signerer med kode fra sofaen. 14 dager gratis — uten kort.
              </p>
              <Button className="mt-4 h-11 px-6 text-base" asChild>
                <Link href={SIGNUP_URL} onClick={() => track("kalkulator_cta_klikket", { plassering: "resultat" })}>
                  Fullfør tilbudet gratis
                  <ArrowRightIcon className="ml-2 size-4" />
                </Link>
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                Tilbud, prosjekt, timer og HMS i ett norsk system.
              </p>
            </div>

            <div className="mt-4 text-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => {
                  setTilbud(null)
                  setBeskrivelse("")
                  window.scrollTo({ top: 0, behavior: "smooth" })
                }}
              >
                Lag et nytt utkast
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
