import type { Metadata } from "next"

import { KalkulatorClient } from "./kalkulator-client"

export const metadata: Metadata = {
  title: "Gratis tilbudskalkulator for håndverkere – Proanbud",
  description:
    "Lim inn notatene fra befaringen og få et pristilbud på sekunder. Forenklet utgave av KI-kalkulasjonen i Proanbud — gratis og uten innlogging.",
  // Canonical peker til verktøysonen på apex, ikke hit. Siden serveres på
  // proanbud.no/verktoy/tilbudskalkulator via multi-zone-rewrite, og det er
  // den adressen som skal indekseres — app-domenet er bare opprinnelsen.
  //
  // Den sto tidligere til "/kalkulator", som mot metadataBase ble
  // proanbud.no/kalkulator: en adresse apex aldri har servert. Google fikk en
  // kanonisk URL som 404-et, ga opp, og indekserte app-domenet i stedet. Samme
  // feilmønster som www-canonical-saken på markedssiden — hvis du endrer denne,
  // sjekk at målet faktisk svarer 200.
  alternates: { canonical: "/verktoy/tilbudskalkulator" },
  openGraph: {
    title: "Gratis tilbudskalkulator for håndverkere",
    description:
      "Fra befaringsnotater til proft pristilbud på sekunder — gratis og uten innlogging.",
    type: "website",
    locale: "nb_NO",
    siteName: "Proanbud",
  },
}

export default function KalkulatorPage() {
  return <KalkulatorClient />
}
