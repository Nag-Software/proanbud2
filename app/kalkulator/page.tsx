import type { Metadata } from "next"

import { KalkulatorClient } from "./kalkulator-client"

export const metadata: Metadata = {
  title: "Gratis tilbudskalkulator for håndverkere – Proanbud",
  description:
    "Lim inn notatene fra befaringen og få et profesjonelt pristilbud på sekunder. Helt gratis, ingen innlogging. Bygget for norske håndverkere.",
  alternates: { canonical: "/kalkulator" },
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
