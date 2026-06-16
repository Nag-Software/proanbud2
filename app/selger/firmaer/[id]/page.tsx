import { notFound } from "next/navigation"

import { FirmaDetailClient } from "@/app/selger/firmaer/[id]/firma-detail-client"
import { fetchSelgerCompany, fetchSelgerCompanyTimeline } from "@/lib/selger/queries"

export const dynamic = "force-dynamic"

export default async function SelgerFirmaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const [company, timeline] = await Promise.all([
    fetchSelgerCompany(id),
    fetchSelgerCompanyTimeline(id),
  ])

  if (!company) {
    notFound()
  }

  return <FirmaDetailClient company={company} timeline={timeline} />
}
