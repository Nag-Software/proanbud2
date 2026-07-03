import { Suspense } from "react"

import { InboxClient } from "./inbox-client"

export const dynamic = "force-dynamic"

export default function SelgerLeadsPage() {
  // Suspense: InboxClient leser ?nytt=1 via useSearchParams.
  return (
    <Suspense fallback={null}>
      <InboxClient />
    </Suspense>
  )
}
