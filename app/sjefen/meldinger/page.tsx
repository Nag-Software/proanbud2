import { Suspense } from "react"

import { MeldingerClient } from "@/app/sjefen/meldinger/meldinger-client"
import { fetchSjefenMessages } from "@/lib/sjefen/queries"

export const dynamic = "force-dynamic"

export default async function SjefenMeldingerPage() {
  const messages = await fetchSjefenMessages()
  return (
    <Suspense>
      <MeldingerClient messages={messages} />
    </Suspense>
  )
}
