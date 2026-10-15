"use client"

/**
 * «Kom i gang»-listen etter omvisningen: fem ting som får firmaet i gang, og
 * hvert punkt krysses av når det faktisk er gjort (lest fra databasen), ikke
 * når man har klikket på det. Ligger som en liten pille nede til høyre og kan
 * åpnes når man vil.
 */

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, PlayIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import {
  KOM_I_GANG,
  komIGangFremdrift,
  komIGangStatus,
  type KomIGangKey,
  type KomIGangTall,
} from "@/lib/onboarding/omvisning"
import { cn } from "@/lib/utils"

/** Ikke oftere enn dette ved sidebytte — listen skal ikke koste databasen noe å snakke om. */
const MIN_PAUSE_MS = 20_000

export function useKomIGangStatus(companyId: string | null, aktiv: boolean, apen: boolean) {
  const pathname = usePathname()
  const [status, setStatus] = React.useState<Record<KomIGangKey, boolean> | null>(null)
  const sistHentet = React.useRef(0)

  const hent = React.useCallback(async () => {
    if (!companyId) return
    sistHentet.current = Date.now()
    const supabase = createClient()
    const telling = { count: "exact" as const, head: true }
    const [firma, prosjekter, tilbud, timer, brukere, invitasjoner] = await Promise.all([
      supabase.from("companies").select("logo_url, address, postal_code, city").eq("id", companyId).maybeSingle(),
      supabase.from("projects").select("id", telling).eq("company_id", companyId),
      supabase.from("offers").select("id", telling).eq("company_id", companyId).neq("status", "draft"),
      supabase.from("time_entries").select("id", telling).eq("company_id", companyId),
      supabase.from("users").select("id", telling).eq("company_id", companyId),
      supabase
        .from("invitations")
        .select("id", telling)
        .eq("company_id", companyId)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString()),
    ])
    const f = firma.data
    const tall: KomIGangTall = {
      harProfil: Boolean(f?.logo_url?.trim() || f?.address?.trim() || f?.postal_code?.trim() || f?.city?.trim()),
      prosjekter: prosjekter.count ?? 0,
      tilbudSendt: tilbud.count ?? 0,
      timer: timer.count ?? 0,
      brukere: brukere.count ?? 0,
      ventendeInvitasjoner: invitasjoner.count ?? 0,
    }
    setStatus(komIGangStatus(tall))
  }, [companyId])

  // Første henting, og på nytt når brukeren har vært et sted (og gjort noe).
  React.useEffect(() => {
    if (!aktiv || !companyId) return
    const pause = status === null ? 0 : apen ? 3_000 : MIN_PAUSE_MS
    if (Date.now() - sistHentet.current < pause) return
    const timer = window.setTimeout(() => void hent(), status === null ? 0 : 600)
    return () => window.clearTimeout(timer)
    // `status` er bare med for første henting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aktiv, apen, companyId, hent, pathname])

  return status
}

function Ring({ andel, storrelse = 28 }: { andel: number; storrelse?: number }) {
  const r = (storrelse - 4) / 2
  const omkrets = 2 * Math.PI * r
  return (
    <svg width={storrelse} height={storrelse} viewBox={`0 0 ${storrelse} ${storrelse}`} className="-rotate-90" aria-hidden>
      <circle cx={storrelse / 2} cy={storrelse / 2} r={r} className="fill-none stroke-muted" strokeWidth={3} />
      <circle
        cx={storrelse / 2}
        cy={storrelse / 2}
        r={r}
        className="fill-none stroke-primary transition-[stroke-dashoffset] duration-700 ease-out"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={omkrets}
        strokeDashoffset={omkrets * (1 - andel)}
      />
    </svg>
  )
}

export function KomIGang({
  status,
  liten,
  onLiten,
  onTur,
  onFerdig,
  onSkjul,
}: {
  status: Record<KomIGangKey, boolean> | null
  liten: boolean
  onLiten: (liten: boolean) => void
  onTur: () => void
  onFerdig: () => void
  onSkjul: () => void
}) {
  // Valgfrie punkter (logo) teller ikke: listen er fullført uten dem.
  const fremdrift = status ? komIGangFremdrift(status) : null
  const gjort = fremdrift?.gjort ?? 0
  const antall = fremdrift?.antall ?? KOM_I_GANG.filter((punkt) => !punkt.valgfri).length
  const alt = fremdrift?.ferdig ?? false
  // Over bunnmenyen på mobilweb; i appen ligger fanelinjen utenfor WebViewen.
  const plass =
    "fixed right-3 bottom-[calc(3.75rem+env(safe-area-inset-bottom)+0.75rem)] z-40 md:right-4 md:bottom-4 [html[data-native]_&]:bottom-4"

  if (liten && !alt) {
    return (
      <button
        type="button"
        onClick={() => onLiten(false)}
        className={cn(
          plass,
          "flex items-center gap-2 rounded-full border bg-background/95 py-1.5 pl-1.5 pr-3.5 shadow-lg backdrop-blur transition-shadow hover:shadow-xl animate-in fade-in-0 slide-in-from-bottom-2 duration-300"
        )}
        aria-label={`Kom i gang, ${gjort} av ${antall} gjort`}
      >
        <Ring andel={gjort / antall} />
        <span className="text-[13px] font-medium">Kom i gang</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {gjort}/{antall}
        </span>
      </button>
    )
  }

  return (
    <div
      className={cn(
        plass,
        "w-[340px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-[14px] border bg-background shadow-2xl animate-in fade-in-0 slide-in-from-bottom-3 duration-300"
      )}
      role="dialog"
      aria-label="Kom i gang"
    >
      {alt ? (
        <div className="p-6 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground animate-in zoom-in-50 duration-500">
            <CheckIcon className="size-6" strokeWidth={2.6} />
          </div>
          <h3 className="mt-3 text-base font-semibold">Firmaet er i gang</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Alt det viktigste er på plass. Resten oppdager du underveis, og omvisningen ligger i brukermenyen.
          </p>
          <Button className="mt-4 w-full" onClick={onFerdig}>
            Lukk
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 px-4 pb-2 pt-3.5">
            <Ring andel={gjort / antall} storrelse={34} />
            <div className="min-w-0 flex-1">
              <h3 className="text-[14px] font-semibold leading-tight">Kom i gang</h3>
              <p className="text-xs tabular-nums text-muted-foreground">
                {status === null ? "Sjekker …" : `${gjort} av ${antall} er gjort`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onLiten(true)}
              className="-mr-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Gjør listen mindre"
            >
              <ChevronDownIcon className="size-4" />
            </button>
          </div>

          <ul className="px-2 pb-1">
            {KOM_I_GANG.map((punkt) => {
              const ferdig = status?.[punkt.key] ?? false
              return (
                <li key={punkt.key}>
                  <Link
                    href={punkt.href}
                    onClick={() => onLiten(true)}
                    className="group flex items-center gap-3 rounded-[10px] px-2 py-2 hover:bg-muted/60"
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                        ferdig ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                      )}
                    >
                      {ferdig && <CheckIcon className="size-3" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-[13px] font-medium", ferdig && "text-muted-foreground line-through decoration-muted-foreground/40")}>
                        {punkt.tittel}
                        {punkt.valgfri && !ferdig && (
                          <span className="ml-1.5 rounded-full bg-muted px-1.5 py-px align-middle text-[10px] font-medium text-muted-foreground">
                            Valgfritt
                          </span>
                        )}
                      </span>
                      {!ferdig && <span className="block truncate text-[12px] text-muted-foreground">{punkt.tekst}</span>}
                    </span>
                    {!ferdig && (
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>

          <div className="flex items-center justify-between border-t px-4 py-2.5">
            <button
              type="button"
              onClick={onTur}
              className="flex items-center gap-1.5 text-[12px] font-medium text-foreground hover:text-primary"
            >
              <PlayIcon className="size-3.5" />
              Ta omvisningen
            </button>
            <button
              type="button"
              onClick={onSkjul}
              className="text-[12px] text-muted-foreground hover:text-foreground"
            >
              Ikke vis igjen
            </button>
          </div>
        </>
      )}
    </div>
  )
}
