import type { Metadata } from "next"

import { CustomerOfferView } from "./customer-offer-view"

export const metadata: Metadata = {
  title: "Tilbud",
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

  return <CustomerOfferView slug={slug} openChat={query.chat === "1"} />
}
