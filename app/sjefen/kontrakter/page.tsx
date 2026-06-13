import { Suspense } from "react"

import { KontrakterClient } from "@/app/sjefen/kontrakter/kontrakter-client"
import { fetchSjefenContracts } from "@/lib/sjefen/queries"

export const dynamic = "force-dynamic"

export default async function SjefenKontrakterPage() {
  const contracts = await fetchSjefenContracts()
  return (
    <Suspense>
      <KontrakterClient contracts={contracts} />
    </Suspense>
  )
}
