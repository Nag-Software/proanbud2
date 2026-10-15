"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"
import { ArrowRightIcon, LayoutTemplateIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { KalkyleChat, type ChatForesporsel } from "@/components/kalkyle/kalkyle-chat"
import { KalkyleProvider, useKalkyle } from "@/components/kalkyle/kalkyle-provider"
import { KalkyleSammendrag } from "@/components/kalkyle/kalkyle-sammendrag"
import { KalkyleStart } from "@/components/kalkyle/kalkyle-start"
import { KalkylePoster } from "@/components/kalkyle/kalkyle-poster"
import { LinjeArk } from "@/components/kalkyle/linje-ark"
import { MinePriserProvider } from "@/components/kalkyle/mine-priser-kontekst"
import { SmartKIIkon } from "@/components/kalkyle/smartki-merke"
import { PrisingLinje } from "@/components/kalkyle/prising-linje"
import { MOCK_KALKYLE } from "@/lib/kalkyle/mock"
import { cn } from "@/lib/utils"
import { useProjectFocus, useProjectShell } from "./project-tabs-shell"

/**
 * Prosjekt → Kalkyle. To visninger av de samme tallene: «Kalkyle» (internt) og
 * «Tilbud» (slik kunden ser det, `?del=tilbud`). Bak KALKYLE_ENABLED, med
 * mock-data til kalkylen kobles til databasen.
 */
export function KalkyleTab() {
  return (
    <MinePriserProvider>
      <KalkyleProvider initial={MOCK_KALKYLE}>
        <KalkyleInnhold />
      </KalkyleProvider>
    </MinePriserProvider>
  )
}

function KalkyleInnhold() {
  const { kalkyle, settKalkyle } = useKalkyle()
  const { setDel } = useProjectShell()
  const visning = useProjectFocus("kalkyle").del === "tilbud" ? "tilbud" : "kalkyle"
  // «Bruk i prosjektet» på Kalkylemaler lenker hit med ?mal=…&storrelse=…
  const searchParams = useSearchParams()
  const malParam = searchParams?.get("mal") ?? null
  const storrelseParam = Number(searchParams?.get("storrelse"))
  const [fraMal] = React.useState(() =>
    malParam ? { malId: malParam, verdi: Number.isFinite(storrelseParam) && storrelseParam > 0 ? storrelseParam : null } : null
  )
  const [visStart, setVisStart] = React.useState(() => fraMal !== null)
  // Malvalget er brukt (eller avbrutt): rydd adressen så en ny lasting ikke åpner startskjermen igjen.
  const ryddMalParam = () => {
    const url = new URL(window.location.href)
    if (!url.searchParams.has("mal") && !url.searchParams.has("storrelse")) return
    url.searchParams.delete("mal")
    url.searchParams.delete("storrelse")
    window.history.replaceState(null, "", url.pathname + url.search)
  }
  const [ark, setArk] = React.useState<{ postId: string; linjeId: string } | null>(null)
  const [chatApen, setChatApen] = React.useState(false)
  const [foresporsel, setForesporsel] = React.useState<ChatForesporsel | null>(null)

  if (!kalkyle || visStart) {
    return (
      <KalkyleStart
        prosjektId={kalkyle?.prosjektId ?? MOCK_KALKYLE.prosjektId}
        startMalId={fraMal?.malId}
        startVerdi={fraMal?.verdi}
        onAvbryt={
          kalkyle
            ? () => {
                ryddMalParam()
                setVisStart(false)
              }
            : undefined
        }
        onFerdig={(k) => {
          ryddMalParam()
          settKalkyle(k)
          setVisStart(false)
        }}
        onBeskriv={(k, tekst) => {
          ryddMalParam()
          settKalkyle(k)
          setVisStart(false)
          setForesporsel({ tekst, id: Date.now() })
        }}
      />
    )
  }

  return (
    <div className={cn("transition-[padding]", chatApen && "lg:pr-[440px]")}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Visning" className="inline-flex gap-0.5 rounded-[9px] bg-secondary p-[3px]">
          {(
            [
              ["kalkyle", "Kalkyle", "internt"],
              ["tilbud", "Tilbud", "kundens visning"],
            ] as const
          ).map(([verdi, navn, under]) => (
            <button
              key={verdi}
              type="button"
              aria-current={visning === verdi ? "page" : undefined}
              onClick={() => setDel(verdi === "tilbud" ? "tilbud" : null)}
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-semibold transition-colors pointer-coarse:min-h-11",
                visning === verdi ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {navn}
              <span className="text-xs font-medium text-muted-foreground">{under}</span>
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" aria-expanded={chatApen} onClick={() => setChatApen(true)}>
            <SmartKIIkon />
            Endre med SmartKI
          </Button>
          <Button type="button" variant="outline" onClick={() => setVisStart(true)}>
            <LayoutTemplateIcon aria-hidden />
            Hent fra mal
          </Button>
          {visning === "kalkyle" && (
            <Button type="button" onClick={() => setDel("tilbud")}>
              Lag tilbud
              <ArrowRightIcon aria-hidden />
            </Button>
          )}
        </div>
      </div>

      {visning === "tilbud" ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="font-semibold">Tilbudet lages fra kalkylen</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Forhåndsvisningen med «Hva skal kunden se?» kommer i neste steg.
          </p>
        </div>
      ) : (
        <div
          className={cn(
            "grid items-start gap-4",
            chatApen ? "2xl:grid-cols-[minmax(0,1fr)_280px]" : "xl:grid-cols-[minmax(0,1fr)_280px]"
          )}
        >
          <section aria-label="Poster" className="flex min-w-0 flex-col gap-3">
            <PrisingLinje />
            <KalkylePoster onAapneLinje={(postId, linjeId) => setArk({ postId, linjeId })} />
          </section>

          <aside aria-label="Sammendrag og neste steg">
            <div className="xl:sticky xl:top-4">
              <KalkyleSammendrag onLagTilbud={() => setDel("tilbud")} />
            </div>
          </aside>
        </div>
      )}

      <LinjeArk valgt={ark} onLukk={() => setArk(null)} />
      <KalkyleChat apen={chatApen} onApenChange={setChatApen} foresporsel={foresporsel} />
    </div>
  )
}
