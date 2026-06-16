import { Suspense } from "react"

import { EpostClient } from "@/app/selger/e-post/epost-client"

export const dynamic = "force-dynamic"

export default function SelgerEpostPage() {
  return (
    <Suspense>
      <EpostClient />
    </Suspense>
  )
}
