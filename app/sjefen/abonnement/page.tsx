import { fetchSubscriptionDashboard } from "@/lib/sjefen/subscription-data"

import { AbonnementClient } from "./abonnement-client"

export const dynamic = "force-dynamic"

export default async function SjefenAbonnementPage() {
  const dashboard = await fetchSubscriptionDashboard()
  return <AbonnementClient dashboard={dashboard} />
}
