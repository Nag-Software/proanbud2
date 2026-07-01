import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { OfferDocumentPreview } from "@/components/tilbud/offer-document-preview"
import { BRANSJE_LABELS, BRANSJE_TRADE, isBransjeKey } from "@/lib/outreach/bransje"
import { EXAMPLE_OFFER_BRANSJER, getExampleOffer } from "@/lib/outreach/example-offers"
import { getOfferDocumentTotals } from "@/lib/tilbud/offer-document"
import { formatNok, type OfferCompanyContext } from "@/lib/tilbud/types"
import { SIGNUP_PATH } from "@/lib/constants"

// Marketing example pages are safe to cache; revalidate daily so the offer date
// stays fresh without rendering on every request.
export const revalidate = 86400

export function generateStaticParams() {
  return EXAMPLE_OFFER_BRANSJER.map((bransje) => ({ bransje }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ bransje: string }>
}): Promise<Metadata> {
  const { bransje } = await params
  if (!isBransjeKey(bransje)) return { title: "Eksempel-tilbud | Proanbud" }

  const trade = BRANSJE_TRADE[bransje]
  const label = BRANSJE_LABELS[bransje]
  const title = `Eksempel-tilbud for ${trade.toLowerCase()} | Proanbud`
  const description = `Se et ferdig tilbud for ${label}, laget på minutter med Proanbud. Slik kan ditt neste tilbud se ut.`
  return {
    title,
    description,
    openGraph: { title, description },
  }
}

const signupHref = (bransje: string) =>
  `${SIGNUP_PATH}?utm_source=eksempel-tilbud&utm_medium=web&utm_content=${bransje}`

export default async function ExampleOfferPage({
  params,
}: {
  params: Promise<{ bransje: string }>
}) {
  const { bransje } = await params
  if (!isBransjeKey(bransje)) notFound()

  const example = getExampleOffer(bransje)
  const label = BRANSJE_LABELS[bransje]
  const { totalInclVatNok } = getOfferDocumentTotals(example.lineItems)
  const issuedDate = new Date().toISOString()

  // Clearly fictitious sender details so the example shows the full document
  // layout (address block, org number, contact line).
  const company: OfferCompanyContext = {
    id: `example-${bransje}`,
    name: example.companyName,
    orgNumber: "999 999 999",
    logoUrl: null,
    address: "Byggveien 12",
    postalCode: "0560",
    city: "Oslo",
    phone: "400 00 000",
  }

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/favicon.ico" alt="" className="h-7 w-7 rounded-md object-contain" />
            <span className="text-sm font-semibold tracking-tight">Proanbud</span>
          </div>
          <Link
            href={signupHref(bransje)}
            className="rounded-lg bg-neutral-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-800 sm:text-sm"
          >
            Prøv gratis i 14 dager
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-600">
            Eksempel-tilbud · {BRANSJE_TRADE[bransje]}
          </span>
          <h1 className="mx-auto mt-4 max-w-2xl text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Her er et tilbud laget for {label} på noen minutter i Proanbud
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-pretty text-sm leading-relaxed text-neutral-600 sm:text-base">
            Slik ville ditt sett ut. Proanbud bygger komplette tilbud med mengder, priser fra dine egne
            leverandører og proff layout — så du slipper kveldene med Excel.
          </p>
          <p className="mt-4 text-sm text-neutral-500">
            Eksempelet under er på{" "}
            <span className="font-semibold text-neutral-900">{formatNok(totalInclVatNok)}</span> inkl. mva.
          </p>
        </section>

        <section className="mt-8 overflow-x-auto rounded-2xl border border-neutral-200 bg-[#eceae4] p-3 shadow-sm sm:p-4">
          <OfferDocumentPreview
            showSupplier={false}
            className="bg-transparent p-0"
            documentClassName="mx-auto w-full max-w-none min-w-0 bg-white shadow-none sm:min-w-[794px]"
            title={example.title}
            description={example.description}
            projectName={example.projectName}
            quoteMessage={example.sourceSummary}
            offerReference="DEMO2026"
            customer={{ name: example.customerName, city: example.customerCity }}
            lineItems={example.lineItems}
            company={company}
            issuedDate={issuedDate}
            validityDays={30}
          />
        </section>

        <section className="mt-10 rounded-2xl border border-neutral-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Lag ditt eget tilbud på minutter</h2>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-neutral-600">
            Skriv inn jobben — Proanbud regner mengder, henter priser og setter opp et ferdig tilbud du kan
            sende kunden direkte. Ingen binding, gratis i 14 dager.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <Link
              href={signupHref(bransje)}
              className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-neutral-800"
            >
              Lag ditt eget gratis tilbud
            </Link>
            <span className="text-xs text-neutral-500">Ferdig på minutter · Ingen kortinfo</span>
          </div>
        </section>
      </main>

      <footer className="border-t border-neutral-200 bg-white">
        <div className="mx-auto max-w-5xl px-4 py-6 text-center text-xs leading-relaxed text-neutral-500 sm:px-6">
          <p>Dette er et eksempel laget av Proanbud. Tall og produkter er illustrerende.</p>
          <p className="mt-1">Levert via Proanbud — tilbud og drift for bygg og anlegg.</p>
        </div>
      </footer>
    </div>
  )
}
