import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRightIcon } from "lucide-react"
import { JsonLd } from "@/components/verktoy/json-ld"
import { VerktoyHeader } from "@/components/verktoy/verktoy-header"
import { VerktoyFooter } from "@/components/verktoy/verktoy-page"
import { SITE_URL, TOOLS } from "@/lib/verktoy/tools"

export const metadata: Metadata = {
  title: "Gratis kalkulatorer og verktøy for håndverkere | Proanbud",
  description:
    "Gratis kalkulatorer for håndverkere: timepris, påslag og dekningsgrad, og pris på jobben. Enkle, raske og uten innlogging — fra Proanbud.",
  alternates: { canonical: "/verktoy" },
  openGraph: {
    title: "Gratis verktøy for håndverkere",
    description: "Timepris, påslag og jobbkalkulator — enkle, raske og gratis.",
    type: "website",
    locale: "nb_NO",
    siteName: "Proanbud",
    url: "/verktoy",
  },
}

// Den KI-drevne tilbudskalkulatoren bor på /kalkulator og tas med som et kort her.
const EXTRA = {
  path: "/kalkulator",
  name: "Tilbudskalkulator",
  teaser: "Lim inn befaringsnotatene og få et ferdig pristilbud på sekunder.",
  glyph: "✨",
}

const cards = [...TOOLS.map((t) => ({ path: t.path, name: t.name, teaser: t.teaser, glyph: t.glyph })), EXTRA]

export default function VerktoyHub() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Gratis verktøy for håndverkere",
    url: `${SITE_URL}/verktoy`,
    inLanguage: "nb-NO",
    isPartOf: { "@type": "WebSite", name: "Proanbud", url: SITE_URL },
    hasPart: cards.map((c) => ({ "@type": "WebApplication", name: c.name, url: `${SITE_URL}${c.path}` })),
  }

  return (
    <div className="min-h-svh bg-muted/30">
      <JsonLd data={jsonLd} />
      <VerktoyHeader source="verktoy-hub" />

      <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-10">
        <header className="max-w-2xl">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Gratis · ingen innlogging
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Gratis verktøy for håndverkere</h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Raske kalkulatorer som gir svar mens du skriver. Regn ut timeprisen din, rydd opp i påslag og margin, og
            sett pris på jobben — helt gratis.
          </p>
        </header>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {cards.map((c) => (
            <Link
              key={c.path}
              href={c.path}
              className="group flex flex-col rounded-2xl border bg-background p-5 shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <span className="text-2xl" aria-hidden>
                {c.glyph}
              </span>
              <p className="mt-3 flex items-center gap-1.5 text-lg font-semibold tracking-tight">
                {c.name}
                <ArrowRightIcon className="size-4 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{c.teaser}</p>
            </Link>
          ))}
        </div>

        <p className="mt-10 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Verktøyene er forenklede utgaver av det Proanbud gjør automatisk med dine egne priser.{" "}
          <Link href="/signup?utm_source=verktoy-hub&utm_medium=verktoy&utm_campaign=gratis-verktoy" className="font-medium text-foreground underline">
            Prøv Proanbud gratis
          </Link>{" "}
          for ferdige, signerbare tilbud på minutter.
        </p>
      </main>

      <VerktoyFooter />
    </div>
  )
}
