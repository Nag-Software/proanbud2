import { Suspense } from "react"

import { TilbudClient } from "@/app/sjefen/tilbud/tilbud-client"
import { fetchSjefenOffers } from "@/lib/sjefen/queries"

export const dynamic = "force-dynamic"

export default async function SjefenTilbudPage() {
  const offers = await fetchSjefenOffers()
  return (
    <Suspense>
      <TilbudClient offers={offers} />
    </Suspense>
  )
}
