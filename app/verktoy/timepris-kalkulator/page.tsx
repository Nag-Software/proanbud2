import type { Metadata } from "next"
import { VerktoyPage, type Faq } from "@/components/verktoy/verktoy-page"
import { TimeprisCalculator } from "@/components/verktoy/calculators/timepris-calculator"
import { getTool } from "@/lib/verktoy/tools"

const tool = getTool("timepris-kalkulator")!

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
  keywords: tool.keywords,
  alternates: { canonical: tool.path },
  openGraph: {
    title: `${tool.heading} – Proanbud`,
    description: tool.description,
    type: "website",
    locale: "nb_NO",
    siteName: "Proanbud",
    url: tool.path,
  },
}

const faq: Faq[] = [
  {
    q: "Hva bør en håndverker ta i timen?",
    a: "Det varierer med fag, erfaring og region, så det finnes ikke ett fasitsvar. Denne kalkulatoren regner i stedet ut hva nettopp du trenger, ut fra lønna di, de faste kostnadene dine og hvor mange timer du faktisk får fakturert. Det er den timeprisen som gjør at du går i pluss.",
  },
  {
    q: "Hvorfor er ikke timeprisen bare lønn delt på timer?",
    a: "Fordi timeprisen også må dekke sosiale kostnader (feriepenger, pensjon, arbeidsgiveravgift), faste kostnader (bil, verktøy, forsikring, regnskap) og all tida som ikke er fakturerbar — pluss en fortjeneste. Regner du bare lønn delt på timer, taper du penger.",
  },
  {
    q: "Hva er fakturerbare timer?",
    a: "Timene du faktisk får betalt for. Tid til befaring, tilbud, kjøring, verksted, opplæring og administrasjon er som regel ikke fakturerbar. Derfor bruker mange 25–35 fakturerbare timer i uka, ikke 37,5.",
  },
  {
    q: "Er timeprisen med eller uten mva?",
    a: "Kalkulatoren viser begge. Til bedriftskunder oppgir du vanligvis pris eks. mva; til privatkunder er det ryddig å vise pris inkl. mva (25 %).",
  },
]

const pitch =
  "Proanbud bruker timeprisen og påslagene dine til å kalkulere hvert tilbud automatisk — og lager et ferdig, signerbart tilbudsdokument på minutter. Ingen regneark som glemmer kostnadene."

export default function Page() {
  return (
    <VerktoyPage tool={tool} pitch={pitch} faq={faq}>
      <TimeprisCalculator />

      <article className="prose-none mt-12 max-w-2xl space-y-4 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Slik regner du ut riktig timepris</h2>
        <p>
          Timeprisen din må dekke fire ting: lønna du vil ha, sosiale kostnader oppå lønna, de faste kostnadene i
          bedriften — og en fortjeneste på toppen. Til slutt deler du alt på timene du faktisk får fakturert, ikke på
          alle timene du jobber.
        </p>
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>Bestem ønsket årslønn før skatt.</li>
          <li>Legg på sosiale kostnader (feriepenger, pensjon, arbeidsgiveravgift, forsikring).</li>
          <li>Legg til alle faste årlige kostnader.</li>
          <li>Del på fakturerbare timer per år (timer per uke × uker med jobb).</li>
          <li>Legg på ønsket fortjeneste for buffer og vekst.</li>
        </ol>
        <p>
          Resultatet er den laveste timeprisen som gjør at du går i pluss. Ligger dagens pris under, ser du med det
          samme hvor mye det utgjør på et helt år.
        </p>
      </article>
    </VerktoyPage>
  )
}
