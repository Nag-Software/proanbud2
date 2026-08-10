import Link from "next/link"
import type { ReactNode } from "react"
import { ChevronRightIcon } from "lucide-react"
import { JsonLd } from "./json-ld"
import { VerktoyHeader } from "./verktoy-header"
import { VerktoyCta } from "./verktoy-cta"
import { SITE_URL, TOOLS, type ToolMeta } from "@/lib/verktoy/tools"

export type Faq = { q: string; a: string }

/**
 * Delt skall for en verktøyside: header, brødsmuler, hero, kalkulatoren
 * (`children`), FAQ, CTA, relaterte verktøy og fot — pluss strukturerte data
 * (SoftwareApplication + BreadcrumbList + FAQPage) for rike Google-resultater.
 */
export function VerktoyPage({
  tool,
  pitch,
  faq,
  children,
}: {
  tool: ToolMeta
  pitch: string
  faq: Faq[]
  children: ReactNode
}) {
  const url = `${SITE_URL}${tool.path}`

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: tool.name,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url,
      description: tool.description,
      inLanguage: "nb-NO",
      offers: { "@type": "Offer", price: "0", priceCurrency: "NOK" },
      provider: { "@type": "Organization", name: "Proanbud", url: SITE_URL },
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Hjem", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Verktøy", item: `${SITE_URL}/verktoy` },
        { "@type": "ListItem", position: 3, name: tool.name, item: url },
      ],
    },
    ...(faq.length
      ? [
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: faq.map((f) => ({
              "@type": "Question",
              name: f.q,
              acceptedAnswer: { "@type": "Answer", text: f.a },
            })),
          },
        ]
      : []),
  ]

  const related = TOOLS.filter((t) => t.slug !== tool.slug)

  return (
    <div className="min-h-svh bg-muted/30">
      <JsonLd data={jsonLd} />
      <VerktoyHeader source={tool.slug} />

      <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6">
        {/* Brødsmuler */}
        <nav aria-label="Brødsmuler" className="flex items-center gap-1 text-xs text-muted-foreground">
          <Link href="/verktoy" className="hover:text-foreground">
            Verktøy
          </Link>
          <ChevronRightIcon className="size-3" />
          <span className="text-foreground">{tool.name}</span>
        </nav>

        {/* Hero */}
        <header className="mt-5">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{tool.heading}</h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">{tool.intro}</p>
        </header>

        {/* Kalkulator + brødtekst */}
        <div className="mt-8">{children}</div>

        {/* FAQ */}
        {faq.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-semibold tracking-tight">Ofte stilte spørsmål</h2>
            <dl className="mt-4 divide-y rounded-2xl border bg-background">
              {faq.map((f) => (
                <div key={f.q} className="p-5">
                  <dt className="font-medium">{f.q}</dt>
                  <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.a}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {/* Produkt-CTA */}
        <VerktoyCta source={tool.slug} pitch={pitch} />

        {/* Relaterte verktøy (intern lenking) */}
        <section className="mt-12">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Flere gratis verktøy</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {related.map((t) => (
              <Link
                key={t.slug}
                href={t.path}
                className="group rounded-xl border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <p className="flex items-center gap-2 font-medium">
                  <span aria-hidden>{t.glyph}</span>
                  {t.name}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">{t.teaser}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>

      <VerktoyFooter />
    </div>
  )
}

export function VerktoyFooter() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto flex w-full max-w-5xl flex-col items-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground sm:flex-row sm:justify-between sm:text-left">
        <p>
          Gratis verktøy fra{" "}
          <a href="https://proanbud.no" className="font-medium text-foreground hover:underline">
            Proanbud
          </a>{" "}
          — samlet arbeidsflyt for bygg- og anleggsbedrifter.
        </p>
        <nav className="flex items-center gap-4">
          <Link href="/verktoy" className="hover:text-foreground">
            Alle verktøy
          </Link>
          <Link href="/kalkulator" className="hover:text-foreground">
            Tilbudskalkulator
          </Link>
          <Link href="/login" className="hover:text-foreground">
            Logg inn
          </Link>
        </nav>
      </div>
    </footer>
  )
}
