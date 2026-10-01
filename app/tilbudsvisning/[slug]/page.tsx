import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { companyHasFeature } from "@/lib/billing/server-modules"
import { fetchPublicOfferBySlug } from "@/lib/tilbud/public-offer"
import { CustomerOfferView } from "./customer-offer-view"

export const metadata: Metadata = {
  title: "Tilbud — Proanbud",
  robots: { index: false, follow: false },
}

export default async function PublicOfferPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ chat?: string }>
}) {
  const { slug } = await params
  const query = await searchParams

  const offer = await fetchPublicOfferBySlug(slug)
  // Samme regel som /api/public/tilbud/[slug]: utkast er ikke offentlige.
  // Avgjøres her så siden svarer med ekte 404 uten innlastingsspinner.
  if (!offer || offer.status === "draft") notFound()

  const chatEnabled = await companyHasFeature(offer.companyId, "meldinger")

  return <CustomerOfferView slug={slug} openChat={query.chat === "1"} chatEnabled={chatEnabled} />
}
