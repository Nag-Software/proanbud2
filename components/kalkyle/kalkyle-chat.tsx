"use client"

import * as React from "react"
import {
  ArrowUpIcon,
  CheckIcon,
  Grid2x2Icon,
  HammerIcon,
  MicIcon,
  PercentIcon,
  SquarePenIcon,
  ThermometerIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { beregnKalkyle } from "@/lib/kalkyle/beregn"
import { CHAT_EKSEMPLER, tolkMock } from "@/lib/kalkyle/chat-mock"
import { beskrivEndringer, brukEndringer, type EndringBeskrivelse, type KalkyleEndring } from "@/lib/kalkyle/endringer"
import { formatKr, formatKrMedFortegn } from "@/lib/kalkyle/format"
import type { Kalkyle } from "@/lib/kalkyle/types"
import { cn } from "@/lib/utils"
import { useKalkyle } from "./kalkyle-provider"
import { SMARTKI_NAVN, SmartKIFlis, SmartKIMerke } from "./smartki-merke"

type Melding =
  | { id: number; fra: "meg"; tekst: string }
  | {
      id: number
      fra: "proanbud"
      tekst: string
      endringer: KalkyleEndring[]
      beskrivelser: EndringBeskrivelse[]
      for: number
      etter: number
      eksempler: string[]
      status: "venter" | "lagtInn" | "avvist"
      /** Kalkylen før «Legg inn», så «Angre» bare er å sette den tilbake. */
      forrige: Kalkyle | null
    }

export type ChatForesporsel = { tekst: string; id: number }

type KalkyleChatProps = {
  apen: boolean
  onApenChange: (apen: boolean) => void
  /** Sender en melding utenfra (f.eks. «Beskriv jobben» på startskjermen). */
  foresporsel?: ChatForesporsel | null
}

/** Svartiden i mock-runden, så «skriver»-prikkene vises. */
const MOCK_FORSINKELSE_MS = 600

/**
 * «Skriv hva du vil endre»: et panel fra høyre (hele skjermen på mobil) som
 * åpnes fra «Endre med SmartKI» i kalkylens verktøylinje. Endrer aldri kalkylen direkte – hvert svar
 * er et forslag med sum før og etter, og først «Legg inn» endrer kalkylen.
 */
export function KalkyleChat({ apen, onApenChange, foresporsel }: KalkyleChatProps) {
  const { kalkyle, settKalkyle, endre, merk } = useKalkyle()
  const [meldinger, setMeldinger] = React.useState<Melding[]>([])
  const [utkast, setUtkast] = React.useState("")
  const [skriver, setSkriver] = React.useState(false)
  const teller = React.useRef(0)
  const loggRef = React.useRef<HTMLDivElement>(null)
  const feltRef = React.useRef<HTMLTextAreaElement>(null)
  const kalkyleRef = React.useRef(kalkyle)
  React.useEffect(() => {
    kalkyleRef.current = kalkyle
  }, [kalkyle])

  const send = React.useCallback(
    (tekst: string) => {
      const ren = tekst.trim()
      if (!ren) return
      teller.current += 1
      setMeldinger((m) => [...m, { id: teller.current, fra: "meg", tekst: ren }])
      setUtkast("")
      setSkriver(true)
      onApenChange(true)
      window.setTimeout(() => {
        const naa = kalkyleRef.current
        setSkriver(false)
        if (!naa) return
        const svar = tolkMock(ren, naa)
        const etter = svar.endringer.length ? brukEndringer(naa, svar.endringer).kalkyle : naa
        teller.current += 1
        setMeldinger((m) => [
          ...m,
          {
            id: teller.current,
            fra: "proanbud",
            tekst: svar.tekst,
            endringer: svar.endringer,
            beskrivelser: beskrivEndringer(naa, svar.endringer),
            for: beregnKalkyle(naa).totalt.inklMva,
            etter: beregnKalkyle(etter).totalt.inklMva,
            eksempler: svar.eksempler,
            status: "venter",
            forrige: null,
          },
        ])
      }, MOCK_FORSINKELSE_MS)
    },
    [onApenChange]
  )

  const sisteForesporsel = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (!foresporsel || sisteForesporsel.current === foresporsel.id) return
    sisteForesporsel.current = foresporsel.id
    send(foresporsel.tekst)
  }, [foresporsel, send])

  React.useEffect(() => {
    loggRef.current?.scrollTo?.({ top: loggRef.current.scrollHeight, behavior: "smooth" })
  }, [meldinger, skriver])

  // Feltet flytter seg fra midten til bunnen ved første melding; fokus følger med.
  const tom = meldinger.length === 0
  React.useEffect(() => {
    if (apen) feltRef.current?.focus()
  }, [apen, tom])

  const settStatus = (id: number, patch: Partial<Extract<Melding, { fra: "proanbud" }>>) =>
    setMeldinger((m) => m.map((x) => (x.id === id && x.fra === "proanbud" ? { ...x, ...patch } : x)))

  const leggInn = (m: Extract<Melding, { fra: "proanbud" }>) => {
    const forrige = kalkyleRef.current
    const berort = endre(m.endringer)
    merk(berort)
    settStatus(m.id, { status: "lagtInn", forrige })
  }

  const angre = (m: Extract<Melding, { fra: "proanbud" }>) => {
    if (m.forrige) settKalkyle(m.forrige)
    settStatus(m.id, { status: "avvist", forrige: null })
  }

  return (
    <>
      {apen && (
        <aside
          aria-label={SMARTKI_NAVN}
          className="fixed inset-0 z-40 flex flex-col bg-[#fcfcfb] lg:inset-y-0 lg:right-0 lg:left-auto lg:w-[440px] lg:border-l lg:shadow-[-16px_0_48px_rgba(21,21,21,0.06)]"
        >
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 pr-2 pl-5">
            <h2>
              <SmartKIMerke />
              <span className="sr-only"> – endre kalkylen</span>
            </h2>
            <div className="flex gap-0.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-full text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                aria-label="Ny samtale"
                onClick={() => setMeldinger([])}
              >
                <SquarePenIcon className="size-[18px]" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 rounded-full text-muted-foreground hover:text-foreground pointer-coarse:size-11"
                aria-label="Lukk samtalen"
                onClick={() => onApenChange(false)}
              >
                <XIcon className="size-[18px]" />
              </Button>
            </div>
          </header>

          {meldinger.length === 0 && !skriver ? (
            <div className="flex flex-1 flex-col justify-center gap-6 overflow-y-auto px-5 pb-[12vh]">
              <div className="flex flex-col items-center gap-4 text-center">
                <SmartKIFlis />
                <div>
                  <h3 className="text-2xl font-semibold tracking-[-0.02em]">Hva vil du endre?</h3>
                  <p className="mx-auto mt-1.5 max-w-[30ch] text-sm leading-relaxed text-muted-foreground">
                    Beskriv det med egne ord. Du ser alltid forslaget før noe endres.
                  </p>
                </div>
              </div>
              <Skrivefelt
                ref={feltRef}
                verdi={utkast}
                onEndre={setUtkast}
                onSend={() => send(utkast)}
                sperret={skriver}
              />
              <ul aria-label="Forslag" className="flex flex-col gap-0.5 px-1">
                {CHAT_EKSEMPLER.map((e, i) => {
                  const Ikon = EKSEMPEL_IKON[i] ?? SquarePenIcon
                  return (
                    <li key={e.tekst}>
                      <button
                        type="button"
                        onClick={() => send(e.tekst)}
                        className="flex min-h-11 w-full items-center gap-3.5 rounded-[12px] px-3 text-left text-[14.5px] text-muted-foreground transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <Ikon aria-hidden className="size-[18px] shrink-0" strokeWidth={1.75} />
                        {e.tekst}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : (
            <>
              <div ref={loggRef} aria-live="polite" className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pt-6 pb-4">
              {meldinger.map((m, i) =>
                m.fra === "meg" ? (
                  <div key={m.id} className="max-w-[85%] self-end rounded-[20px] bg-[#efefed] px-4 py-2.5 text-[15px] leading-relaxed">
                    {m.tekst}
                  </div>
                ) : (
                  <div key={m.id} className="flex flex-col gap-3 text-[15px] leading-relaxed">
                    <p>{m.tekst}</p>
                    {m.endringer.length > 0 && (
                      <Forslag
                        melding={m}
                        onLeggInn={() => leggInn(m)}
                        onAvvis={() => settStatus(m.id, { status: "avvist" })}
                        onAngre={() => angre(m)}
                      />
                    )}
                    {m.eksempler.length > 0 && i === meldinger.length - 1 && (
                      <div className="flex flex-wrap gap-2">
                        {m.eksempler.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => send(e)}
                            className="min-h-11 rounded-full border bg-background px-3.5 text-[13.5px] hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}

              {skriver && (
                <div role="status" aria-label="Regner på det" className="flex gap-1.5 py-1.5">
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      className="size-1.5 animate-pulse rounded-full bg-muted-foreground"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              )}
              </div>
              <div className="px-4 pb-2">
                <Skrivefelt
                  ref={feltRef}
                  verdi={utkast}
                  onEndre={setUtkast}
                  onSend={() => send(utkast)}
                  sperret={skriver}
                />
              </div>
              <p className="mx-4 mb-3 text-center text-xs text-muted-foreground">Ingenting endres før du trykker «Legg inn».</p>
            </>
          )}
        </aside>
      )}
    </>
  )
}

const TEGN_STIL: Record<EndringBeskrivelse["tegn"], string> = {
  "+": "bg-[#eef6e3] text-[#4d7219]",
  "~": "bg-[#edf1fb] text-[color:var(--tone-info-strong)]",
  "−": "bg-[#fbeceb] text-destructive",
}

function Forslag({
  melding,
  onLeggInn,
  onAvvis,
  onAngre,
}: {
  melding: Extract<Melding, { fra: "proanbud" }>
  onLeggInn: () => void
  onAvvis: () => void
  onAngre: () => void
}) {
  const antall = melding.beskrivelser.length
  return (
    <div className="overflow-hidden rounded-[16px] border bg-background">
      <p className="px-4 pt-3 text-[12.5px] font-semibold text-muted-foreground">
        {antall === 1 ? "1 endring" : `${antall} endringer`}
      </p>
      <ul className="px-4">
        {melding.beskrivelser.map((b, i) => (
          <li key={i} className="flex items-center gap-3 border-b py-2.5 last:border-b-0">
            <span
              aria-hidden
              className={cn("flex size-[22px] shrink-0 items-center justify-center rounded-full text-sm font-bold", TEGN_STIL[b.tegn])}
            >
              {b.tegn}
            </span>
            <span className="min-w-0 flex-1 text-sm leading-snug">
              {b.tekst}
              <span className="block text-[12.5px] text-muted-foreground">{b.sted}</span>
            </span>
            {b.belop !== null && (
              <span className="whitespace-nowrap text-sm font-semibold tabular-nums">{formatKrMedFortegn(b.belop)}</span>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-1.5 border-t px-4 py-3 text-sm tabular-nums">
        <span className="text-muted-foreground">Kunden betaler</span>
        <span>
          <span className="text-muted-foreground line-through">{formatKr(melding.for)}</span>{" "}
          <span aria-hidden className="text-muted-foreground">
            →
          </span>{" "}
          <strong className="text-[15px]">{formatKr(melding.etter)}</strong>
        </span>
      </div>
      {melding.status === "venter" && (
        <div className="flex justify-end gap-1.5 px-3 pb-3">
          <Button type="button" variant="ghost" className="h-11 rounded-full" onClick={onAvvis}>
            Nei takk
          </Button>
          <Button type="button" className="h-11 rounded-full px-5" onClick={onLeggInn}>
            Legg inn
          </Button>
        </div>
      )}
      {melding.status === "lagtInn" && (
        <div className="flex items-center justify-between gap-2 px-4 pb-2.5 text-sm">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#4d7219]">
            <CheckIcon aria-hidden className="size-4" />
            Lagt inn
          </span>
          {melding.forrige && (
            <Button type="button" variant="ghost" className="h-10 rounded-full" onClick={onAngre}>
              Angre
            </Button>
          )}
        </div>
      )}
      {melding.status === "avvist" && <p className="px-4 pb-3 text-sm text-muted-foreground">Ikke lagt inn.</p>}
    </div>
  )
}

const EKSEMPEL_IKON: LucideIcon[] = [ThermometerIcon, HammerIcon, Grid2x2Icon, PercentIcon]

type Gjenkjenner = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

/** Nettleserens egen diktering (Chrome, Safari, Edge). Vises ikke der den mangler. */
function lagGjenkjenner(): Gjenkjenner | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as Record<string, (new () => Gjenkjenner) | undefined>
  const Klasse = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Klasse ? new Klasse() : null
}

const dikteringStottet = () =>
  typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)

type SkrivefeltProps = {
  verdi: string
  onEndre: (verdi: string) => void
  onSend: () => void
  sperret: boolean
  ref?: React.Ref<HTMLTextAreaElement>
}

/**
 * Skrivefeltet: én rund linje som vokser når teksten blir lengre, mikrofon
 * og en rund send-knapp. Enter sender, Shift+Enter gir ny linje.
 */
function Skrivefelt({ verdi, onEndre, onSend, sperret, ref }: SkrivefeltProps) {
  const egenRef = React.useRef<HTMLTextAreaElement>(null)
  const rammeRef = React.useRef<HTMLDivElement>(null)
  const gjenkjenner = React.useRef<Gjenkjenner | null>(null)
  const [lytter, setLytter] = React.useState(false)
  const kanDiktere = dikteringStottet()
  const kanSende = verdi.trim().length > 0 && !sperret

  React.useImperativeHandle(ref, () => egenRef.current as HTMLTextAreaElement)

  // Høyden følger teksten (maks ca. seks linjer); flere linjer gir mindre rundt hjørne.
  React.useLayoutEffect(() => {
    const felt = egenRef.current
    const ramme = rammeRef.current
    if (!felt || !ramme) return
    felt.style.height = "auto"
    felt.style.height = `${Math.min(felt.scrollHeight, 160)}px`
    ramme.dataset.flerlinje = String(felt.scrollHeight > 44)
  }, [verdi])

  React.useEffect(() => () => gjenkjenner.current?.stop(), [])

  const diktér = () => {
    if (lytter) {
      gjenkjenner.current?.stop()
      return
    }
    const g = lagGjenkjenner()
    if (!g) return
    g.lang = "nb-NO"
    g.interimResults = false
    g.continuous = false
    const start = verdi.trim()
    g.onresult = (e) => {
      const tekst = Array.from(e.results, (r) => r[0]?.transcript ?? "").join(" ").trim()
      onEndre(start ? `${start} ${tekst}` : tekst)
    }
    g.onend = () => setLytter(false)
    g.onerror = () => setLytter(false)
    gjenkjenner.current = g
    setLytter(true)
    g.start()
  }

  return (
    <div
      ref={rammeRef}
      className="flex items-end gap-1 rounded-[28px] border bg-background py-1.5 pr-1.5 pl-5 shadow-[0_2px_12px_rgba(21,21,21,0.06)] transition-[border-radius] focus-within:border-foreground/25 data-[flerlinje=true]:rounded-[22px]"
    >
      <label htmlFor="kalkyle-chat-felt" className="sr-only">
        Skriv hva du vil endre i kalkylen
      </label>
      <textarea
        ref={egenRef}
        id="kalkyle-chat-felt"
        rows={1}
        value={verdi}
        onChange={(e) => onEndre(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            if (kanSende) onSend()
          }
        }}
        placeholder={lytter ? "Snakk nå …" : "Skriv hva du vil endre …"}
        className="max-h-40 min-h-9 flex-1 resize-none self-center bg-transparent py-1.5 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
      />
      {kanDiktere && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-9 shrink-0 rounded-full text-muted-foreground hover:text-foreground pointer-coarse:size-11",
            lytter && "bg-destructive/10 text-destructive hover:text-destructive"
          )}
          aria-label={lytter ? "Stopp diktering" : "Snakk inn"}
          aria-pressed={lytter}
          onClick={diktér}
        >
          <MicIcon className="size-[18px]" />
        </Button>
      )}
      <Button
        type="button"
        size="icon"
        className="size-9 shrink-0 rounded-full border-transparent disabled:border-transparent disabled:bg-[#dcdcda] disabled:text-white disabled:opacity-100 disabled:shadow-none pointer-coarse:size-11"
        aria-label="Send"
        disabled={!kanSende}
        onClick={onSend}
      >
        <ArrowUpIcon className="size-[18px]" strokeWidth={2.25} />
      </Button>
    </div>
  )
}
