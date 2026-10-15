import type * as React from "react"

import { KalkyleOmrade } from "../../components/kalkyle/kalkyle-omrade"
import { ConfirmProvider } from "../../components/ui/confirm-dialog"

/**
 * Prosjektsiden i tester: samme tilstand som `KalkyleOmrade` i page.tsx og
 * bekreftelsesdialogen fra app/layout. `eksempel` gir badet i Fjellveien 12
 * (ekte prosjekter starter uten kalkyle).
 */
export function Prosjektside({ children, eksempel = true }: { children: React.ReactNode; eksempel?: boolean }) {
  return (
    <ConfirmProvider>
      <KalkyleOmrade eksempel={eksempel}>{children}</KalkyleOmrade>
    </ConfirmProvider>
  )
}
