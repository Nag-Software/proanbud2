import type { Metadata } from "next"

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
  const chatEnabled = offer ? await companyHasFeature(offer.companyId, "meldinger") : false

  return <CustomerOfferView slug={slug} openChat={query.chat === "1"} chatEnabled={chatEnabled} />
}
