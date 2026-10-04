import { fetchCancellationDashboard } from "@/lib/platform/cancellations"
import { OppsigelserClient } from "./oppsigelser-client"

export const dynamic = "force-dynamic"

export default async function SjefenOppsigelserPage() {
  const dashboard = await fetchCancellationDashboard()

  return <OppsigelserClient dashboard={dashboard} />
}
