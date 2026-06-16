import { OverviewClient } from "@/app/selger/overview-client"
import { fetchSelgerCompaniesFiltered, fetchSelgerDashboardStats } from "@/lib/selger/queries"

export const dynamic = "force-dynamic"

export default async function SelgerOverviewPage() {
  const [stats, companies] = await Promise.all([
    fetchSelgerDashboardStats(),
    fetchSelgerCompaniesFiltered(),
  ])

  return <OverviewClient stats={stats} initialCompanies={companies} />
}
