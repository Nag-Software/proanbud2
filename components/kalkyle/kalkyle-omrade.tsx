"use client"

import type * as React from "react"

import { MOCK_KALKYLE, MOCK_SIGNERT_SNAPSHOT } from "@/lib/kalkyle/mock"
import { KalkyleProvider } from "./kalkyle-provider"
import { MinePriserProvider } from "./mine-priser-kontekst"

/**
 * Felles tilstand for Kalkyle og Etterkalkyle på prosjektsiden: bedriftens
 * priser og prosjektets kalkyler med tilbud. Et prosjekt starter uten kalkyle
 * (startskjermen), så ingen ekte prosjekt viser eksempelbadet. `eksempel` gir
 * badet i Fjellveien 12 med signert tilbud, til tester og demo.
 */
export function KalkyleOmrade({ children, eksempel = false }: { children: React.ReactNode; eksempel?: boolean }) {
  return (
    <MinePriserProvider>
      <KalkyleProvider initial={eksempel ? MOCK_KALKYLE : null} initialTilbud={eksempel ? [MOCK_SIGNERT_SNAPSHOT] : []}>
        {children}
      </KalkyleProvider>
    </MinePriserProvider>
  )
}
