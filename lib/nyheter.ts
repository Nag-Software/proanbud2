/**
 * «Nytt i Proanbud»: korte nyheter i varselbjella. Hver nyhet vises som ulest
 * til brukeren har åpnet den (eller markert alle som lest), og forsvinner av
 * seg selv etter `visTil`. Nye kunder etter den datoen slipper gamle nyheter.
 *
 * Lest-status ligger per bruker i localStorage (se hooks/use-nyheter.ts).
 */

import { KALKYLE_ENABLED } from "@/lib/kalkyle/flag"

export type Nyhet = {
  id: string
  tittel: string
  tekst: string
  /** Artikkelen på proanbud.no. */
  href: string
  /** Når nyheten ble lagt ut (ISO-dato). Sorteres sammen med andre varsler. */
  dato: string
  /** Etter denne datoen vises den ikke lenger. */
  visTil: string
  /** Bare for dem som faktisk har tilgang til det nyheten handler om. */
  vis: (k: { erHandverker: boolean }) => boolean
}

export const NYHETER: Nyhet[] = [
  {
    id: "kalkyle-2026-10",
    tittel: "Nytt: Kalkyle på prosjektet",
    tekst:
      "Regn ut jobben fra en mal eller dine egne priser, lag tilbudet rett fra kalkylen, og se etterpå hva jobben faktisk tjente.",
    href: "https://proanbud.no/artikler/kalkyle-i-proanbud",
    dato: "2026-10-16",
    visTil: "2026-12-15",
    // Kalkylen er bak flagg til den er lansert, og håndverkere ser den ikke.
    vis: ({ erHandverker }) => KALKYLE_ENABLED && !erHandverker,
  },
]

/** Nyhetene som gjelder nå, nyeste først. */
export function aktuelleNyheter(k: { erHandverker: boolean }, naa = new Date()): Nyhet[] {
  const idag = naa.toISOString().slice(0, 10)
  return NYHETER.filter((nyhet) => nyhet.dato <= idag && idag <= nyhet.visTil && nyhet.vis(k)).sort((a, b) =>
    b.dato.localeCompare(a.dato)
  )
}
