import type { Metadata } from "next"
import { VerktoyPage, type Faq } from "@/components/verktoy/verktoy-page"
import { PaaslagCalculator } from "@/components/verktoy/calculators/paaslag-calculator"
import { getTool } from "@/lib/verktoy/tools"

const tool = getTool("paaslag-kalkulator")!

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
    q: "Hva er forskjellen på påslag og dekningsgrad?",
    a: "Påslag regnes av innkjøpsprisen: kjøper du for 1000 kr og legger på 40 %, selger du for 1400 kr. Dekningsgrad (margin) regnes av salgsprisen: da er dekningsbidraget 400 kr av 1400 kr, altså 28,6 %. Samme handel — to ulike tall. Derfor blir 40 % påslag aldri 40 % margin.",
  },
  {
    q: "Hvordan regner jeg ut påslag?",
    a: "Påslag i prosent = (utsalgspris − innkjøpspris) ÷ innkjøpspris × 100. Vil du finne utsalgsprisen, ganger du innkjøpsprisen med (1 + påslag ÷ 100). Kalkulatoren gjør begge veier automatisk.",
  },
  {
    q: "Hva er et vanlig påslag på materiell?",
    a: "Det varierer med fag og bransje, men mange håndverkere legger på et sted mellom 15 og 50 % på materiell for å dekke innkjøp, håndtering, svinn og fortjeneste. Bruk kalkulatoren til å se hvilken dekningsgrad påslaget ditt faktisk gir.",
  },
  {
    q: "Skal jeg regne påslag med eller uten mva?",
    a: "Regn alltid påslag og margin på priser eks. mva. Merverdiavgiften legges på til slutt (25 %) og er kun noe du krever inn på vegne av staten — den er ikke en del av fortjenesten din.",
  },
]

const pitch =
  "I Proanbud ligger innkjøpsprisene og påslagene dine per vare klare — så hvert tilbud får riktig margin uten at du regner manuelt. Last opp prisfila fra grossisten din, så er du i gang."

export default function Page() {
  return (
    <VerktoyPage tool={tool} pitch={pitch} faq={faq}>
      <PaaslagCalculator />

      <article className="prose-none mt-12 max-w-2xl space-y-4 text-sm leading-relaxed text-muted-foreground">
        <h2 className="text-xl font-semibold tracking-tight text-foreground">Påslag eller margin — hva bør du bruke?</h2>
        <p>
          Bruk <strong>påslag</strong> når du priser fra innkjøpsprisen og oppover: «Jeg legger 40 % på det jeg betaler
          for varen.» Bruk <strong>dekningsgrad</strong> (margin) når du styrer etter hvor mye av salgsprisen som skal
          bli igjen som fortjeneste: «Jeg vil ha 30 % margin på alt jeg selger.»
        </p>
        <p>
          Feilen mange gjør er å tro at 40 % påslag gir 40 % margin. Det gjør det ikke — det gir 28,6 %. Skal du sikre en
          bestemt margin, bytt til «Ønsket margin» i kalkulatoren, så finner den påslaget du må bruke.
        </p>
      </article>
    </VerktoyPage>
  )
}
