import type { Metadata } from "next"
import { VerktoyPage, type Faq } from "@/components/verktoy/verktoy-page"
import { JobbCalculator } from "@/components/verktoy/calculators/jobb-calculator"
import { getTool } from "@/lib/verktoy/tools"

const tool = getTool("jobbkalkulator")!

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
    q: "Hvordan regner jeg ut hva en jobb koster?",
    a: "Legg sammen arbeid (timer × timepris), materiell med påslag, kjøring og en buffer for det uforutsette. Det gir prisen eks. mva. Legg til 25 % mva til slutt for prisen kunden betaler. Kalkulatoren gjør hele regnestykket mens du fyller inn.",
  },
  {
    q: "Skal jeg legge på mva i tilbudet?",
    a: "Er du mva-registrert, skal prisen til privatkunder vises inkl. mva (25 %). Til bedriftskunder oppgir du vanligvis eks. mva. Kalkulatoren viser begge summene så du kan velge riktig for tilbudet.",
  },
  {
    q: "Hvor mye buffer bør jeg legge på?",
    a: "En buffer på 5–15 % på hele jobben er vanlig for å dekke uventet arbeid, prisstigning på materiell og svinn. Jo mer usikker jobben er, jo høyere buffer bør du ta.",
  },
  {
    q: "Bør jeg ta betalt for kjøring?",
    a: "Ja — kjøring er en reell kostnad (drivstoff, bompenger, tid). Legg den inn som kilometer × sats eller som et fast beløp, så den ikke spiser av fortjenesten.",
  },
]

const pitch =
  "Proanbud gjør prisoverslaget til et ferdig tilbud: linjer, betalingsplan, forbehold og din logo — som kunden kan signere digitalt. Alt bygger på dine egne priser."

export default function Page() {
  return (
    <VerktoyPage tool={tool} pitch={pitch} faq={faq}>
      <JobbCalculator />

      <article className="prose-none mt-12 max-w-2xl space-y-4 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Slik bygger du et prisoverslag</h2>
        <p>
          Et godt overslag har fire deler: <strong>arbeid</strong> (timer ganget med timeprisen din),{" "}
          <strong>materiell</strong> med et påslag som dekker innkjøp og håndtering, <strong>kjøring</strong>, og en{" "}
          <strong>buffer</strong> for det uforutsette. Summen av disse er prisen eks. mva.
        </p>
        <p>
          Vet du ikke hvilken timepris du bør bruke? Regn den ut i{" "}
          <a href="/verktoy/timepris-kalkulator" className="font-medium text-foreground underline">
            timepris-kalkulatoren
          </a>{" "}
          først, og sett riktig påslag med{" "}
          <a href="/verktoy/paaslag-kalkulator" className="font-medium text-foreground underline">
            påslagskalkulatoren
          </a>
          .
        </p>
      </article>
    </VerktoyPage>
  )
}
