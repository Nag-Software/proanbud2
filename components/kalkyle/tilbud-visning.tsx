"use client"

import * as React from "react"
import Link from "next/link"
import { ArrowLeftIcon, CheckIcon, LockIcon, PlusIcon, SaveIcon, SendIcon } from "lucide-react"
import { toast } from "sonner"

import { OfferCustomerSignalLabel } from "@/components/tilbud/customer-signal"
import { offerStatusConfigByValue } from "@/components/tilbud/columns"
import { OfferDocumentViewer } from "@/components/tilbud/offer-document-viewer"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { beregnKalkyle, byggKundevisning } from "@/lib/kalkyle/beregn"
import { formatDato, formatKr, formatProsent } from "@/lib/kalkyle/format"
import { kundevisningTilLinjer } from "@/lib/kalkyle/tilbud-dokument"
import type { Detaljniva, Kalkyle, TilbudSnapshot, TilbudStatus } from "@/lib/kalkyle/types"
import { getOfferCustomerSignal, type OfferCustomerSignalInput } from "@/lib/tilbud/customer-signal"
import type { OfferDocumentCustomer } from "@/lib/tilbud/offer-document"
import type { OfferCompanyContext } from "@/lib/tilbud/types"
import { cn } from "@/lib/utils"
import { useKalkyle } from "./kalkyle-provider"

export type ProsjektTilbud = OfferCustomerSignalInput & {
  id: string
  title: string
  status: "draft" | "sent" | "accepted" | "rejected"
  amountNok: number
}

export type TilbudProsjekt = {
  id: string
  navn: string
  kunde: OfferDocumentCustomer
}

export type TilbudValg = { detaljniva: Detaljniva; visTimer: boolean }

const NIVAER: Array<{ verdi: Detaljniva; navn: string; forklaring: string }> = [
  { verdi: "total", navn: "Kun totalsum", forklaring: "Én linje med fastprisen." },
  { verdi: "post", navn: "Per post", forklaring: "Én linje per post, f.eks. «Membran og fliser»." },
  { verdi: "linje", navn: "Alle linjer", forklaring: "Hver linje med mengde og pris." },
]

type TilbudVisningProps = {
  prosjekt: TilbudProsjekt
  tilbud: ProsjektTilbud[]
  /** Firmahodet strømmes fra serveren så prosjektsiden ikke venter på det. */
  firma: Promise<OfferCompanyContext | null> | null
  valg: TilbudValg
  onValgChange: (valg: TilbudValg) => void
  onTilKalkylen: () => void
}

/**
 * Kalkyle → «Tilbud · kundens visning». Tilbudet bygges fra kalkylen med
 * byggKundevisning og vises i samme dokument som andre tilbud. «Nå» følger
 * kalkylen; lagrede tilbud (v1, v2 …) er frosne kopier, og et signert tilbud
 * er låst. Til venstre: versjonene, hva kunden skal se, det interne kortet og
 * tilbudene på prosjektet.
 */
export function TilbudVisning({ prosjekt, tilbud, firma, valg, onValgChange, onTilKalkylen }: TilbudVisningProps) {
  const { kalkyle, tilbud: versjoner, lagreTilbud, settTilbudStatus } = useKalkyle()
  const [valgtId, setValgtId] = React.useState<string | null>(null)
  if (!kalkyle) return null

  // Et tilbud som ikke hører til valgt kalkyle (etter bytte) betyr «Nå».
  const valgt = versjoner.find((o) => o.id === valgtId) ?? null
  const visKalkyle: Kalkyle = valgt?.kalkyle ?? kalkyle
  const visValg: TilbudValg = valgt ? { detaljniva: valgt.detaljniva, visTimer: valgt.visTimer } : valg
  const t = beregnKalkyle(visKalkyle).totalt
  const harSignert = versjoner.some((o) => o.status === "signert")

  const lagre = () => {
    const id = lagreTilbud(valg)
    if (!id) return null
    setValgtId(id)
    return id
  }
  const send = (id: string | null) => {
    if (!id) return
    settTilbudStatus(id, "sendt")
    toast.success("Tilbudet er merket som sendt", {
      description: "Utsending kommer når tilbudet fra kalkylen lagres. Last ned PDF fungerer allerede.",
    })
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside aria-label="Innstillinger for tilbudet" className="flex flex-col gap-3">
        <TilbudVersjoner valgtId={valgt?.id ?? null} onVelg={setValgtId} />

        <section className="rounded-lg border bg-card p-3.5 shadow-[var(--shadow-surface)]">
          <fieldset disabled={valgt !== null}>
            <legend className="mb-2 text-sm font-semibold">Hva skal kunden se?</legend>
            <div className="flex flex-col gap-1.5">
              {NIVAER.map((n) => {
                const erValgt = visValg.detaljniva === n.verdi
                return (
                  <label
                    key={n.verdi}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-[8px] border bg-background px-3 py-2.5 transition-colors hover:bg-muted/40 has-[:disabled]:cursor-default has-[:disabled]:hover:bg-background has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring",
                      erValgt ? "border-foreground" : "border-border"
                    )}
                  >
                    <input
                      type="radio"
                      name="detaljniva"
                      value={n.verdi}
                      checked={erValgt}
                      onChange={() => onValgChange({ ...valg, detaljniva: n.verdi })}
                      className="mt-0.5 size-4 shrink-0 accent-foreground"
                    />
                    <span>
                      <span className="block text-sm font-medium">{n.navn}</span>
                      <span className="block text-xs text-muted-foreground">{n.forklaring}</span>
                    </span>
                  </label>
                )
              })}
            </div>
          </fieldset>
          <label className="mt-3 flex min-h-9 cursor-pointer items-center gap-2.5 border-t pt-3 text-sm has-[:disabled]:cursor-default has-[:disabled]:text-muted-foreground">
            <Checkbox
              checked={visValg.visTimer && visValg.detaljniva !== "total"}
              disabled={valgt !== null || visValg.detaljniva === "total"}
              onCheckedChange={(v) => onValgChange({ ...valg, visTimer: v === true })}
            />
            Vis antall timer per post
          </label>
          {valgt && (
            <p className="mt-2 text-xs text-muted-foreground">
              Valgene er lagret med {valgt.navn}. Velg «Nå» for å lage et nytt tilbud.
            </p>
          )}
        </section>

        <section aria-label="Kun synlig for deg" className="rounded-lg bg-foreground p-3.5 text-background">
          <div className="mb-2.5 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Din margin</h3>
            <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[11px] font-bold text-accent-foreground">
              <LockIcon aria-hidden className="size-3" />
              Kun synlig for deg
            </span>
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1.5 text-[13px] tabular-nums">
            <dt className="text-background/70">Kostnad</dt>
            <dd className="text-right">{formatKr(t.kost)}</dd>
            <dt className="text-background/70">Fortjeneste</dt>
            <dd className="text-right">{formatKr(t.fortjeneste)}</dd>
            <dt className="text-background/70">Dekningsgrad</dt>
            <dd className="text-right font-semibold text-accent">{formatProsent(t.dekningsgrad)}</dd>
          </dl>
          <button
            type="button"
            onClick={onTilKalkylen}
            className="mt-2.5 inline-flex min-h-9 items-center gap-1.5 text-[13px] font-semibold text-accent underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-accent"
          >
            <ArrowLeftIcon aria-hidden className="size-3.5" />
            Endre i kalkylen
          </button>
        </section>

        <TilbudPaProsjektet prosjektId={prosjekt.id} tilbud={tilbud} />
      </aside>

      <section aria-label="Forhåndsvisning slik kunden ser tilbudet" className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">
            {valgt ? <VersjonStatusTekst tilbud={valgt} /> : "Slik ser kunden tilbudet. Prisene følger kalkylen."}
          </p>
          <div className="flex flex-wrap gap-2">
            {!valgt && (
              <>
                <Button type="button" variant="outline" onClick={() => lagre()}>
                  <SaveIcon aria-hidden />
                  Lagre som tilbud
                </Button>
                <Button type="button" onClick={() => send(lagre())}>
                  <SendIcon aria-hidden />
                  Send til kunde for signering
                </Button>
              </>
            )}
            {valgt?.status === "utkast" && (
              <Button type="button" onClick={() => send(valgt.id)}>
                <SendIcon aria-hidden />
                Send til kunde for signering
              </Button>
            )}
            {valgt?.status === "sendt" && !harSignert && (
              <Button type="button" variant="outline" onClick={() => settTilbudStatus(valgt.id, "signert")}>
                <CheckIcon aria-hidden />
                Merk som signert
              </Button>
            )}
          </div>
        </div>
        <React.Suspense fallback={<div className="h-[600px] animate-pulse rounded-lg bg-muted/40" />}>
          <Dokument
            prosjekt={prosjekt}
            firma={firma}
            kalkyle={visKalkyle}
            valg={visValg}
            dato={valgt ? (valgt.sendtDato ?? valgt.opprettet) : null}
          />
        </React.Suspense>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          <p className="text-[13px] text-muted-foreground">
            Kunden godtar tilbudet digitalt fra lenken i e-posten. Knappen er bare en forhåndsvisning.
          </p>
          <Button type="button" disabled>
            Godta tilbud
          </Button>
        </div>
      </section>
    </div>
  )
}

const STATUS: Record<TilbudStatus, { navn: string; dot: string }> = {
  utkast: { navn: "Utkast", dot: offerStatusConfigByValue.draft.dotClass },
  sendt: { navn: "Sendt", dot: offerStatusConfigByValue.sent.dotClass },
  signert: { navn: "Signert", dot: offerStatusConfigByValue.accepted.dotClass },
  avvist: { navn: "Avvist", dot: offerStatusConfigByValue.rejected.dotClass },
}

function VersjonStatusTekst({ tilbud }: { tilbud: TilbudSnapshot }) {
  if (tilbud.status === "signert") {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
        <LockIcon aria-hidden className="size-3.5" />
        {tilbud.navn} er signert {tilbud.signertDato ? formatDato(tilbud.signertDato) : ""} og låst. Endringer i kalkylen blir et nytt tilbud.
      </span>
    )
  }
  if (tilbud.status === "sendt") return <>{tilbud.navn} ble sendt {formatDato(tilbud.sendtDato ?? tilbud.opprettet)}. Slik så kunden det.</>
  if (tilbud.status === "avvist") return <>{tilbud.navn} ble avvist av kunden.</>
  return <>{tilbud.navn} er lagret {formatDato(tilbud.opprettet)}, men ikke sendt.</>
}

/** «Nå» (følger kalkylen) og de lagrede tilbudene til valgt kalkyle. */
function TilbudVersjoner({ valgtId, onVelg }: { valgtId: string | null; onVelg: (id: string | null) => void }) {
  const { tilbud, resultat } = useKalkyle()
  const knapp = (aktiv: boolean) =>
    cn(
      "flex min-h-11 w-full items-center justify-between gap-3 rounded-[8px] border px-3 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring",
      aktiv ? "border-foreground bg-background" : "border-transparent"
    )
  return (
    <section aria-label="Tilbud fra kalkylen" className="rounded-lg border bg-card p-3.5 shadow-[var(--shadow-surface)]">
      <h3 className="mb-2 text-sm font-semibold">Tilbud fra kalkylen</h3>
      <div className="flex flex-col gap-1">
        <button type="button" aria-pressed={valgtId === null} onClick={() => onVelg(null)} className={knapp(valgtId === null)}>
          <span className="min-w-0">
            <span className="block text-[13px] font-medium">Nå</span>
            <span className="block text-xs text-muted-foreground">Følger kalkylen</span>
          </span>
          <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatKr(resultat?.totalt.inklMva ?? 0)}</span>
        </button>
        {[...tilbud].reverse().map((o) => {
          const status = STATUS[o.status]
          return (
            <button key={o.id} type="button" aria-pressed={valgtId === o.id} onClick={() => onVelg(o.id)} className={knapp(valgtId === o.id)}>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[13px] font-medium">
                  {o.navn}
                  {o.erLast && <LockIcon aria-label="Låst" className="size-3 text-muted-foreground" />}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span aria-hidden className={cn("size-1.5 rounded-full", status.dot)} />
                  {status.navn} {formatDato(o.signertDato ?? o.sendtDato ?? o.opprettet)}
                </span>
              </span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums">
                {formatKr(beregnKalkyle(o.kalkyle).totalt.inklMva)}
              </span>
            </button>
          )
        })}
      </div>
      {tilbud.length === 0 && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          «Lagre som tilbud» tar vare på en kopi. Senere endringer i kalkylen endrer ikke den.
        </p>
      )}
    </section>
  )
}

function Dokument({
  prosjekt,
  firma,
  kalkyle,
  valg,
  dato,
}: {
  prosjekt: TilbudProsjekt
  firma: Promise<OfferCompanyContext | null> | null
  kalkyle: Kalkyle
  valg: TilbudValg
  /** Datoen et lagret tilbud ble sendt (eller lagret); null = i dag. */
  dato: string | null
}) {
  const company = firma ? React.use(firma) : null
  const lineItems = React.useMemo(
    () => kundevisningTilLinjer(byggKundevisning(kalkyle, valg.detaljniva, valg.visTimer, prosjekt.navn)),
    [kalkyle, valg.detaljniva, valg.visTimer, prosjekt.navn]
  )
  // Dagens dato som utstedelsesdato, beregnet én gang så dokumentet ikke bytter dato mens man ser på det.
  const [idag] = React.useState(() => new Date())

  return (
    <OfferDocumentViewer
      title={prosjekt.navn}
      customer={prosjekt.kunde}
      lineItems={lineItems}
      company={company}
      issuedDate={dato ? new Date(dato) : idag}
      validityDays={company?.quoteValidityDays ?? 30}
      pricingModel="fixed"
    />
  )
}

function TilbudPaProsjektet({ prosjektId, tilbud }: { prosjektId: string; tilbud: ProsjektTilbud[] }) {
  return (
    <section aria-label="Tilbud på prosjektet" className="rounded-lg border bg-card p-3.5 shadow-[var(--shadow-surface)]">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Tilbud på prosjektet</h3>
        <span className="text-xs text-muted-foreground tabular-nums">{tilbud.length}</span>
      </div>
      {tilbud.length === 0 ? (
        <p className="py-2 text-[13px] text-muted-foreground">Ingen tilbud ennå.</p>
      ) : (
        <ul className="divide-y">
          {tilbud.map((o) => {
            const status = offerStatusConfigByValue[o.status]
            const signal = getOfferCustomerSignal(o)
            return (
              <li key={o.id}>
                <Link
                  href={`/tilbud/${o.id}`}
                  className="flex min-h-11 items-start justify-between gap-3 py-2 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{o.title || "Uten tittel"}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className={cn("size-1.5 rounded-full", status?.dotClass)} />
                        {status?.label ?? o.status}
                      </span>
                      {signal && <OfferCustomerSignalLabel signal={signal} />}
                    </span>
                  </span>
                  <span className="shrink-0 text-[13px] font-semibold tabular-nums">{formatKr(o.amountNok)}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <Link
        href={`/nytt-tilbud?projectId=${prosjektId}`}
        className="mt-1.5 inline-flex min-h-9 items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground"
      >
        <PlusIcon aria-hidden className="size-3.5" />
        Nytt tilbud uten kalkyle
      </Link>
    </section>
  )
}
