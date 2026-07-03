import { notFound, redirect } from "next/navigation"

import { FirmaDetailClient } from "@/app/selger/firmaer/[id]/firma-detail-client"
import { fetchSelgerCompany, fetchSelgerCompanyTimeline } from "@/lib/selger/queries"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export default async function SelgerFirmaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Har firmaet en salgsprosess (prospect-rad), er lead-kortet den kanoniske
  // visningen — firmaer/[id] består kun som kunde-detalj for rene kunder.
  const admin = createAdminClient()
  const { data: linkedProspect } = await admin
    .from("prospects")
    .select("id")
    .eq("matched_company_id", id)
    .maybeSingle()
  if (linkedProspect) {
    redirect(`/selger/leads/${linkedProspect.id}`)
  }

  const [company, timeline] = await Promise.all([
    fetchSelgerCompany(id),
    fetchSelgerCompanyTimeline(id),
  ])

  if (!company) {
    notFound()
  }

  return <FirmaDetailClient company={company} timeline={timeline} />
}
