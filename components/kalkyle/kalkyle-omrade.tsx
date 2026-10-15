"use client"

import type * as React from "react"

import { MOCK_KALKYLE, MOCK_SIGNERT_SNAPSHOT } from "@/lib/kalkyle/mock"
import { KalkyleProvider } from "./kalkyle-provider"
import { MinePriserProvider } from "./mine-priser-kontekst"

/**
 * Felles tilstand for Kalkyle og Etterkalkyle på prosjektsiden: bedriftens
 * priser og prosjektets kalkyler med tilbud. Mock-runden starter med badet i
 * Fjellveien 12 og dets signerte tilbud.
 */
export function KalkyleOmrade({ children }: { children: React.ReactNode }) {
  return (
    <MinePriserProvider>
      <KalkyleProvider initial={MOCK_KALKYLE} initialTilbud={[MOCK_SIGNERT_SNAPSHOT]}>
        {children}
      </KalkyleProvider>
    </MinePriserProvider>
  )
}
