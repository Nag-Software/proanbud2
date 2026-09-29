"use client"

import { usePathname } from "next/navigation"
import { useEffect, useSyncExternalStore } from "react"

import { createFreshnessTracker, isStale, type PageStamp } from "@/lib/perf/freshness"
import { refreshCurrentPageAction } from "@/lib/perf/refresh-action"

/**
 * Stille oppfrisking av serverdata på siden brukeren står på.
 *
 * Forvarmede sider vises øyeblikkelig fra ruter-cachen, men kan være opptil
 * fem minutter gamle. Er dataene eldre enn sidens ferskhetsvindu når siden
 * vises (eller når fanen blir synlig igjen), rendres siden på nytt i
 * bakgrunnen — brukeren ser innholdet med en gang, og det oppdaterer seg selv
 * et øyeblikk senere hvis noe har endret seg.
 */

// Hvor lenge vi venter etter ankomst før vi frisker opp. Lar sidens egne
// forespørsler gå først, og gjør at en rask videre-navigasjon ikke rekker å
// avbryte oppfriskingen (Next kaster da hele ruter-cachen i stedet).
const ARRIVAL_DELAY_MS = 600

let currentStamp: PageStamp | null = null
const tracker = createFreshnessTracker()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Kalles av AppPageShellClient når en side med serverdata vises. */
export function registerPageStamp(stamp: PageStamp): () => void {
  currentStamp = stamp
  tracker.observe(stamp.renderedAt, Date.now())
  emit()
  return () => {
    if (currentStamp === stamp) {
      currentStamp = null
      emit()
    }
  }
}

// Én oppfrisking per stempel: når svaret kommer har siden et nytt stempel, så
// en side som fortsatt er gammel etter en oppfrisking (feil, avbrudd) prøves
// ikke i løkke — neste ankomst eller fanebytte prøver igjen.
let lastRefreshedRenderedAt: number | null = null

function refreshIfStale(pathname: string) {
  if (document.visibilityState !== "visible") return
  const stamp = currentStamp
  if (!stamp || stamp.renderedAt === lastRefreshedRenderedAt) return
  if (!isStale(stamp, pathname, tracker.ageOf(stamp.renderedAt, Date.now()))) return
  lastRefreshedRenderedAt = stamp.renderedAt
  refreshCurrentPageAction().catch(() => {
    // Typisk nettverksbrudd, eller en server action som ikke finnes lenger
    // etter en ny deploy. Siden fungerer med dataene den har — ingen støy til
    // brukeren, og ingen feillogg (det ville vært én per bruker per deploy).
  })
}

export function PageFreshness() {
  const pathname = usePathname()
  const stamp = useSyncExternalStore(subscribe, () => currentStamp, () => null)
  const renderedAt = stamp?.pathname === pathname ? stamp.renderedAt : null

  // Ved ankomst (eller når siden får et nytt stempel): sjekk etter en kort pause.
  useEffect(() => {
    if (renderedAt === null) return
    const timer = window.setTimeout(() => refreshIfStale(pathname), ARRIVAL_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [pathname, renderedAt])

  // Tilbake til fanen etter en stund: frisk opp siden som står fremme.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refreshIfStale(pathname)
    }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [pathname])

  return null
}
