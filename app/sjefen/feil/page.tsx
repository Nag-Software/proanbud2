import { fetchErrorLogDashboard } from "@/lib/platform/error-logs"
import { FeilClient } from "./feil-client"

export const dynamic = "force-dynamic"

export default async function SjefenFeilPage({
  searchParams,
}: {
  searchParams: Promise<{ vis?: string }>
}) {
  const params = await searchParams
  const includeResolved = params?.vis === "alle"
  const dashboard = await fetchErrorLogDashboard({ includeResolved })

  return <FeilClient dashboard={dashboard} includeResolved={includeResolved} />
}
