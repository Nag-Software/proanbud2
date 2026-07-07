"use client"

import { useMemo, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { ArrowRightIcon, Loader2Icon, SparklesIcon } from "lucide-react"

import { OfferDocumentPreview } from "@/components/tilbud/offer-document-preview"
import type { OfferDocumentData } from "@/lib/tilbud/offer-document"
import type { OfferLineItem } from "@/lib/tilbud/types"
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
  lineItems: OfferLineItem[]
  forbehold: string[]
  betalingsplan: Array<{ label: string; percent: number }> | null
  totalInklMvaNok: number
}

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

  // Mater det EKTE tilbudsdokumentet (samme komponent som betalende kunder
  // ser) med kalkulator-resultatet — placeholder-parter til brukeren har konto.
  const documentData: OfferDocumentData | null = useMemo(() => {
    if (!tilbud) return null
    const issued = new Date()
    const validUntil = new Date(issued.getTime() + 14 * 24 * 60 * 60 * 1000)
    return {
      title: tilbud.tittel,
      description: tilbud.innledning,
      offerReference: "UTKAST",
      customer: {
        name: "Kari Nordmann",
        address: "Eksempelveien 12",
        postalCode: "3084",
        city: "Holmestrand",
      },
      lineItems: tilbud.lineItems,
      company: {
        id: "kalkulator-utkast",
        name: "Ditt firma AS",
        orgNumber: null,
        logoUrl: null,
      },
      issuedDate: issued,
      validityDays: 14,
      quoteValidUntil: validUntil.toISOString(),
      paymentSchedule: tilbud.betalingsplan ?? null,
      pricingModel: "fixed",
    }
  }, [tilbud])

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
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-4">
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

      <main className="mx-auto w-full max-w-4xl px-4 pb-20 pt-10">
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
            sekunder — som et ekte tilbudsdokument, klart til å justeres og sendes.
          </p>
          <p className="mx-auto max-w-xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
            <span className="font-semibold">PS:</span> Dette er en forenklet kalkulator — mindre
            nøyaktig enn KI-kalkulasjonen i Proanbud, som bruker dine egne priser.
          </p>
        </div>

        {/* Skjema */}
        <div className="mx-auto mt-8 max-w-3xl rounded-2xl border bg-background p-5 shadow-sm sm:p-6">
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

        {/* Resultat: det ekte tilbudsdokumentet med vannmerke */}
        {tilbud && documentData && (
          <div className="mt-10">
            <div className="relative overflow-hidden rounded-2xl border shadow-sm">
              {/* Vannmerke over dokumentet */}
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <p className="-rotate-[24deg] select-none whitespace-nowrap text-4xl font-bold uppercase tracking-[0.35em] text-gray-900/[0.05] sm:text-6xl">
                  Utkast · Proanbud
                </p>
              </div>

              <div className="overflow-x-auto">
                <OfferDocumentPreview
                  {...documentData}
                  extraTerms={tilbud.forbehold}
                  showSupplier
                  className="bg-[#e8e6e1] p-3 sm:p-6"
                  documentClassName="mx-auto w-full min-w-[660px] max-w-[794px] bg-white shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
                />
              </div>

              <div className="relative z-20 border-t bg-muted/60 px-6 py-3 text-center text-xs text-muted-foreground">
                Laget med Proanbud · proanbud.no
              </div>
            </div>

            <p className="mt-3 text-center text-xs text-muted-foreground">
              Forenklet overslag basert på standardpriser — regn med avvik.
            </p>

            {/* CTA */}
            <div className="mx-auto mt-6 max-w-3xl rounded-2xl border border-primary/25 bg-primary/5 p-6 text-center sm:p-8">
              <h3 className="text-lg font-semibold tracking-tight">Vil du ha en nøyaktig kalkyle?</h3>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Med gratis prøveperiode får du den fulle KI-kalkulasjonen med dine egne priser —
                og tilbudet med din logo, klart til digital signering. 14 dager gratis — uten kort.
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
